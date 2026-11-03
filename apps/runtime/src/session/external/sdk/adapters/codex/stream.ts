import type { WorkerResult } from "../../contract.js";
import { resultFromSdkMessage } from "../../host/result.js";
import type { CodexAskUserIdBridge } from "./ask-user-bridge.js";
import type { CodexUsage } from "./load.js";

/**
 * 把 Codex runStreamed 事件转成 Host 鸭子消息：
 * - agent_message → assistant text
 * - mcp_tool_call → tool_use / tool_result（解包 agentup / ask_user）
 * - command_execution / file_change → 通用 tool 卡
 * - turn.completed / turn.failed → type:"result"
 * 绝不合成 toolcall_*。
 */

export async function* mirrorCodexEvents(
  events: AsyncIterable<unknown>,
  extras?: { askUserBridge?: CodexAskUserIdBridge },
): AsyncGenerator<unknown, void, undefined> {
  let threadId: string | undefined;
  let sawTerminal = false;

  for await (const event of events) {
    if (!event || typeof event !== "object") continue;
    const row = event as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type : "";

    if (type === "thread.started") {
      threadId = typeof row.thread_id === "string" ? row.thread_id : threadId;
      yield {
        type: "system",
        subtype: "init",
        session_id: threadId,
      };
      continue;
    }

    if (type === "item.started" || type === "item.updated" || type === "item.completed") {
      const item = row.item;
      if (!item || typeof item !== "object") continue;
      for (const message of projectItem(item as Record<string, unknown>, type, extras)) {
        yield message;
      }
      continue;
    }

    if (type === "turn.completed") {
      sawTerminal = true;
      const usage = usageOf(row.usage);
      yield {
        type: "result",
        subtype: "success",
        result: "",
        session_id: threadId,
        usage,
        permission_denials: [],
      };
      continue;
    }

    if (type === "turn.failed" || type === "error") {
      sawTerminal = true;
      const err =
        row.error && typeof row.error === "object"
          ? (row.error as { message?: string }).message
          : typeof row.message === "string"
            ? row.message
            : "Codex turn failed";
      yield {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        result: "",
        errors: [err || "Codex turn failed"],
        session_id: threadId,
        permission_denials: [],
      };
    }
  }

  if (!sawTerminal) {
    yield {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "",
      errors: ["stream ended without turn.completed"],
      session_id: threadId,
      permission_denials: [],
    };
  }
}

function projectItem(
  item: Record<string, unknown>,
  eventType: string,
  extras?: { askUserBridge?: CodexAskUserIdBridge },
): unknown[] {
  const itemType = typeof item.type === "string" ? item.type : "";
  const id = typeof item.id === "string" ? item.id : "";

  if (itemType === "agent_message") {
    const text = typeof item.text === "string" ? item.text : "";
    if (!text) return [];
    // 只在 completed 落整段，避免 started/updated/completed 重复累加正文
    if (eventType === "item.completed") {
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
    return [];
  }

  if (itemType === "reasoning") {
    const text = typeof item.text === "string" ? item.text : "";
    if (!text || eventType === "item.completed") return [];
    return [
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: text },
        },
      },
    ];
  }

  if (itemType === "mcp_tool_call") {
    return projectMcpTool(item, eventType, extras);
  }

  if (itemType === "command_execution") {
    return projectNamedTool(
      id,
      "command_execution",
      {
        command: item.command,
        aggregated_output: item.aggregated_output,
        exit_code: item.exit_code,
      },
      eventType,
      statusOf(item),
      typeof item.aggregated_output === "string" ? item.aggregated_output : "",
    );
  }

  if (itemType === "file_change") {
    return projectNamedTool(
      id,
      "file_change",
      { changes: item.changes },
      eventType,
      statusOf(item),
      JSON.stringify(item.changes ?? []),
    );
  }

  if (itemType === "web_search") {
    return projectNamedTool(
      id,
      "web_search",
      { query: item.query },
      eventType,
      eventType === "item.completed" ? "completed" : "running",
      typeof item.query === "string" ? item.query : "",
    );
  }

  if (itemType === "error") {
    const message = typeof item.message === "string" ? item.message : "error";
    if (eventType !== "item.completed" && eventType !== "item.started") return [];
    return [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: message }],
        },
      },
    ];
  }

  return [];
}

function projectMcpTool(
  item: Record<string, unknown>,
  eventType: string,
  extras?: { askUserBridge?: CodexAskUserIdBridge },
): unknown[] {
  const id = typeof item.id === "string" ? item.id : "";
  if (!id) return [];
  const server = typeof item.server === "string" ? item.server : "";
  const tool = typeof item.tool === "string" ? item.tool : "tool";
  const args = argsOf(item.arguments);
  const projected = unwrapCodexMcpTool(server, tool, args);

  if (
    (projected.name === "ask_user" || projected.name === "agentup_ask_user") &&
    (eventType === "item.started" || eventType === "item.updated")
  ) {
    extras?.askUserBridge?.publish(id);
  }

  const status = statusOf(item);
  if (eventType === "item.started" || (eventType === "item.updated" && status === "in_progress")) {
    return [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id,
              name: projected.name,
              input: projected.args,
            },
          ],
        },
      },
    ];
  }

  if (eventType === "item.completed" || status === "completed" || status === "failed") {
    const isError = status === "failed" || Boolean(item.error);
    const content = isError
      ? errorText(item)
      : stringifyCodexToolResult(item.result);
    return [
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: id,
              content,
              is_error: isError,
            },
          ],
        },
      },
    ];
  }
  return [];
}

function projectNamedTool(
  id: string,
  name: string,
  args: Record<string, unknown>,
  eventType: string,
  status: string,
  resultText: string,
): unknown[] {
  if (!id) return [];
  if (eventType === "item.started" || (eventType === "item.updated" && status === "in_progress")) {
    return [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id, name, input: args }],
        },
      },
    ];
  }
  if (eventType === "item.completed" || status === "completed" || status === "failed") {
    return [
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: id,
              content: resultText,
              is_error: status === "failed",
            },
          ],
        },
      },
    ];
  }
  return [];
}

/**
 * Codex 流里 MCP 已是 server + tool 分离，不是 Cursor 元工具 `mcp`。
 * - agentup_ask / agentup_ask_user → ask_user
 * - agentup + tool X → mcp__agentup__X
 */
export function unwrapCodexMcpTool(
  server: string,
  tool: string,
  args: Record<string, unknown>,
): { name: string; args: Record<string, unknown> } {
  const serverId = server.trim();
  const toolName = tool.trim() || "tool";

  if (
    toolName === "agentup_ask_user" ||
    serverId === "agentup_ask" ||
    serverId === "custom-user-tools"
  ) {
    return { name: "ask_user", args };
  }

  if (serverId === "agentup") {
    return { name: `mcp__agentup__${toolName}`, args };
  }

  if (serverId) {
    return { name: `mcp__${serverId}__${toolName}`, args };
  }
  return { name: toolName, args };
}

export function stringifyCodexToolResult(raw: unknown): string {
  return unwrapMcpToolResultText(raw);
}

export function workerResultFromCodexMessage(message: unknown): WorkerResult | null {
  return resultFromSdkMessage(message);
}

/** 收尾时若 finalResponse 已知，补进空 result（stream 末尾常只有 usage）。 */
export function resultMessageWithText(
  base: unknown,
  finalText: string,
): unknown {
  if (!base || typeof base !== "object") return base;
  const row = base as Record<string, unknown>;
  if (row.type !== "result") return base;
  const existing = typeof row.result === "string" ? row.result : "";
  if (existing.trim()) return base;
  return { ...row, result: finalText };
}

function usageOf(raw: unknown): Record<string, number | undefined> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = raw as CodexUsage;
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_input_tokens: usage.cached_input_tokens,
    cache_creation_input_tokens: usage.cache_write_input_tokens,
  };
}

function statusOf(item: Record<string, unknown>): string {
  return typeof item.status === "string" ? item.status : "";
}

function argsOf(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function errorText(item: Record<string, unknown>): string {
  const err = item.error;
  if (err && typeof err === "object" && !Array.isArray(err)) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "tool failed";
}

function unwrapMcpToolResultText(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return raw;
    try {
      return unwrapMcpToolResultText(JSON.parse(trimmed) as unknown) || raw;
    } catch {
      return raw;
    }
  }
  if (typeof raw !== "object") return String(raw);
  const row = raw as Record<string, unknown>;
  if (row.value && typeof row.value === "object" && !Array.isArray(row.value)) {
    const inner = unwrapMcpToolResultText(row.value);
    if (inner) return inner;
  }
  if (Array.isArray(row.content)) {
    const parts = row.content
      .map((item) => unwrapMcpContentBlock(item))
      .filter(Boolean);
    if (parts.length > 0) return parts.join("\n");
  }
  const block = unwrapMcpContentBlock(raw);
  if (block) return block;
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

function unwrapMcpContentBlock(item: unknown): string {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  const row = item as Record<string, unknown>;
  if (typeof row.text === "string") return row.text;
  if (row.text && typeof row.text === "object" && !Array.isArray(row.text)) {
    const nested = row.text as Record<string, unknown>;
    if (typeof nested.text === "string") return nested.text;
  }
  return "";
}
