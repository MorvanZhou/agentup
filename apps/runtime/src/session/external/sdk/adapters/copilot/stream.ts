import type { WorkerResult } from "../../contract.js";
import { resultFromSdkMessage } from "../../host/result.js";

/**
 * 把 Copilot session 事件转成 Host 鸭子消息：
 * - assistant.message_delta / assistant.message → 文本
 * - tool.execution_start / complete → tool_use / tool_result
 * - session.idle → type:"result"
 * 绝不合成 toolcall_*。
 */

type PendingTool = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  announced: boolean;
};

export async function* mirrorCopilotSession(
  session: {
    sessionId?: string;
    on: {
      (event: string, handler: (event: unknown) => void): unknown;
      (handler: (event: unknown) => void): unknown;
    };
  },
  waitIdle: Promise<void>,
): AsyncGenerator<unknown, void, undefined> {
  const sessionId =
    typeof session.sessionId === "string" ? session.sessionId : undefined;

  const queue: unknown[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  let sawTerminal = false;
  const pendingTools = new Map<string, PendingTool>();

  const push = (message: unknown) => {
    queue.push(message);
    wake?.();
  };

  const onEvent = (event: unknown) => {
    for (const message of projectCopilotEvent(event, pendingTools)) {
      push(message);
    }
    if (isIdleEvent(event)) {
      sawTerminal = true;
      push(resultMessageOf(sessionId, "completed"));
    }
    if (isErrorEvent(event)) {
      sawTerminal = true;
      push(resultMessageOf(sessionId, "error", errorTextOf(event)));
    }
  };

  // 必须在 yield init 前订完：否则 generator 停在首个 yield 时还没挂上，早期 delta 会丢。
  // 只订一条路径：SDK _dispatchEvent 会先跑 typed 再跑 wildcard，
  // 两边都挂同一 onEvent → 每个 delta 进两遍，reasoning 变成「word word」口吃。
  let subscribed = false;
  try {
    session.on(onEvent);
    subscribed = true;
  } catch {
    /* 部分版本只支持 typed */
  }
  if (!subscribed) {
    for (const type of [
      "assistant.message_delta",
      "assistant.message",
      "assistant.reasoning_delta",
      "assistant.reasoning",
      "tool.execution_start",
      "tool.execution_complete",
      "session.idle",
      "session.error",
      "error",
    ]) {
      try {
        session.on(type, onEvent);
      } catch {
        /* ignore */
      }
    }
  }

  yield {
    type: "system",
    subtype: "init",
    session_id: sessionId,
  };

  void waitIdle.finally(() => {
    closed = true;
    if (!sawTerminal) {
      push(
        resultMessageOf(sessionId, "error", "stream ended without session.idle"),
      );
    }
    wake?.();
  });

  while (!closed || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
      continue;
    }
    yield queue.shift();
  }
}

export function projectCopilotEvent(
  event: unknown,
  pendingTools: Map<string, PendingTool>,
): unknown[] {
  if (!event || typeof event !== "object") return [];
  const row = event as Record<string, unknown>;
  const type = typeof row.type === "string" ? row.type : "";
  const data =
    row.data && typeof row.data === "object" && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : row;

  if (type === "assistant.message_delta" || type === "assistant.reasoning_delta") {
    const delta =
      typeof data.deltaContent === "string"
        ? data.deltaContent
        : typeof data.content === "string"
          ? data.content
          : "";
    if (!delta) return [];
    const thinking = type === "assistant.reasoning_delta";
    return [
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: thinking
            ? { type: "thinking_delta", thinking: delta }
            : { type: "text_delta", text: delta },
        },
      },
    ];
  }

  if (type === "assistant.message") {
    const text =
      typeof data.content === "string"
        ? data.content
        : typeof data.text === "string"
          ? data.text
          : "";
    if (!text) return [];
    return [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
        },
      },
    ];
  }

  if (type === "assistant.reasoning") return [];

  if (type === "tool.execution_start") {
    return projectToolStart(data, pendingTools);
  }
  if (type === "tool.execution_complete") {
    return projectToolComplete(data, pendingTools);
  }

  return [];
}

function projectToolStart(
  data: Record<string, unknown>,
  pendingTools: Map<string, PendingTool>,
): unknown[] {
  const id = toolIdOf(data);
  if (!id) return [];
  const rawName =
    typeof data.toolName === "string"
      ? data.toolName
      : typeof data.name === "string"
        ? data.name
        : "tool";
  const args = argsOf(data);
  const projected = unwrapCopilotMcpTool(rawName, args);
  // 空参延迟 announce（协助 tab 需要非空扁平 args，见 contract §2.2.1）
  const pending: PendingTool = {
    id,
    name: projected.name,
    args: projected.args,
    announced: false,
  };
  pendingTools.set(id, pending);
  if (!hasNonEmptyArgs(projected.args)) return [];
  pending.announced = true;
  return [toolUseMessage(id, projected.name, projected.args)];
}

function projectToolComplete(
  data: Record<string, unknown>,
  pendingTools: Map<string, PendingTool>,
): unknown[] {
  const id = toolIdOf(data);
  if (!id) return [];
  const pending = pendingTools.get(id);
  const rawName =
    typeof data.toolName === "string"
      ? data.toolName
      : typeof data.name === "string"
        ? data.name
        : pending?.name || "tool";
  const args = Object.keys(argsOf(data)).length > 0 ? argsOf(data) : pending?.args || {};
  const projected = unwrapCopilotMcpTool(rawName, args);
  const out: unknown[] = [];
  if (!pending?.announced) {
    out.push(toolUseMessage(id, projected.name, projected.args));
  }
  pendingTools.delete(id);
  const isError =
    data.success === false ||
    data.isError === true ||
    data.error != null ||
    (typeof data.status === "string" &&
      ["error", "failed", "denied"].includes(data.status.toLowerCase()));
  out.push({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          content: stringifyCopilotToolResult(
            data.result ?? data.output ?? data.content ?? data.error,
          ),
          is_error: isError,
        },
      ],
    },
  });
  return out;
}

function toolUseMessage(
  id: string,
  name: string,
  args: Record<string, unknown>,
): unknown {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id,
          name,
          input: args,
        },
      ],
    },
  };
}

/**
 * Copilot MCP 工具名常见形：
 * - mcp:agentup-delegate_to_agent
 * - agentup-delegate_to_agent
 */
export function unwrapCopilotMcpTool(
  name: string,
  args: Record<string, unknown>,
): { name: string; args: Record<string, unknown> } {
  const trimmed = name.trim();
  if (!trimmed) return { name: "tool", args };

  if (
    trimmed === "ask_user" ||
    trimmed === "AskUserQuestion" ||
    trimmed.endsWith("-ask_user") ||
    trimmed.endsWith("/ask_user")
  ) {
    return { name: "ask_user", args: flatArgs(args) };
  }

  let server = "";
  let tool = trimmed;
  const mcpColon = trimmed.match(/^mcp[:/](.+)$/i);
  if (mcpColon?.[1]) {
    const rest = mcpColon[1];
    const split = rest.match(/^([^/-]+)[-/](.+)$/);
    if (split) {
      server = split[1]!;
      tool = split[2]!;
    } else {
      tool = rest;
    }
  } else if (trimmed.includes("-") && trimmed.startsWith("agentup")) {
    const idx = trimmed.indexOf("-");
    server = trimmed.slice(0, idx);
    tool = trimmed.slice(idx + 1);
  }

  const serverFromArgs =
    typeof args.server === "string"
      ? args.server.trim()
      : typeof args.providerIdentifier === "string"
        ? args.providerIdentifier.trim()
        : "";
  if (!server && serverFromArgs) server = serverFromArgs;

  const inner = flatArgs(args);
  if (server === "agentup" || server === "agentup_ask") {
    if (tool === "agentup_ask_user" || tool === "ask_user") {
      return { name: "ask_user", args: inner };
    }
    return { name: `mcp__agentup__${tool}`, args: inner };
  }

  return { name: trimmed, args: inner };
}

export function stringifyCopilotToolResult(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return raw;
    try {
      return stringifyCopilotToolResult(JSON.parse(trimmed) as unknown) || raw;
    } catch {
      return raw;
    }
  }
  if (typeof raw !== "object") return String(raw);
  const row = raw as Record<string, unknown>;
  if (Array.isArray(row.content)) {
    const parts = row.content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const block = item as Record<string, unknown>;
          if (typeof block.text === "string") return block.text;
        }
        return "";
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join("\n");
  }
  if (typeof row.text === "string") return row.text;
  if (typeof row.result === "string") return row.result;
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

export function workerResultFromCopilotMessage(message: unknown): WorkerResult | null {
  return resultFromSdkMessage(message);
}

function resultMessageOf(
  sessionId: string | undefined,
  kind: "completed" | "error",
  error?: string,
): unknown {
  if (kind === "error") {
    return {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "",
      errors: [error || "Copilot turn failed"],
      session_id: sessionId,
      permission_denials: [],
    };
  }
  return {
    type: "result",
    subtype: "success",
    result: "",
    session_id: sessionId,
    permission_denials: [],
  };
}

function isIdleEvent(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  return (event as { type?: unknown }).type === "session.idle";
}

function isErrorEvent(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const type = (event as { type?: unknown }).type;
  return type === "session.error" || type === "error";
}

function errorTextOf(event: unknown): string {
  if (!event || typeof event !== "object") return "Copilot turn failed";
  const row = event as Record<string, unknown>;
  const data =
    row.data && typeof row.data === "object"
      ? (row.data as Record<string, unknown>)
      : row;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  if (typeof data.error === "string" && data.error.trim()) return data.error;
  return "Copilot turn failed";
}

function toolIdOf(data: Record<string, unknown>): string {
  for (const key of [
    "toolCallId",
    "tool_call_id",
    "callId",
    "id",
    "executionId",
    "toolUseId",
  ]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function argsOf(data: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["toolArgs", "arguments", "args", "input", "parameters"]) {
    const value = data[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === "string" && value.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return {};
}

function flatArgs(args: Record<string, unknown>): Record<string, unknown> {
  const inner = args.args;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  const { server: _s, providerIdentifier: _p, toolName: _t, ...rest } = args;
  return rest;
}

function hasNonEmptyArgs(args: Record<string, unknown>): boolean {
  return Object.keys(args).length > 0;
}
