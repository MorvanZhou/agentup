import type { WorkerResult } from "../../contract.js";
import { resultFromSdkMessage } from "../../host/result.js";
import type { CursorRunResult, CursorSdkAgent, CursorSdkRun } from "./load.js";

/**
 * 把 Cursor run.stream() 转成 Host 已认的鸭子消息：
 * - assistant / system（init）可直接给 external/events
 * - tool_call → assistant tool_use + user tool_result
 * - 收尾合成 type:"result"（与 CodeBuddy ResultMessage 同形）
 */

export async function* mirrorCursorRun(
  agent: CursorSdkAgent,
  run: CursorSdkRun,
): AsyncGenerator<unknown, void, undefined> {
  yield {
    type: "system",
    subtype: "init",
    session_id: agent.agentId,
  };

  for await (const event of run.stream()) {
    for (const message of projectCursorEvent(event)) {
      yield message;
    }
  }

  const settled = await run.wait();
  yield resultMessageOf(settled, agent.agentId);
}

function projectCursorEvent(event: unknown): unknown[] {
  if (!event || typeof event !== "object") return [];
  const row = event as Record<string, unknown>;
  const type = typeof row.type === "string" ? row.type : "";

  if (type === "assistant") {
    return [event];
  }
  if (type === "thinking") {
    const text = typeof row.text === "string" ? row.text : "";
    if (!text) return [];
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
  if (type === "tool_call") {
    return projectToolCall(row);
  }
  return [];
}

function projectToolCall(row: Record<string, unknown>): unknown[] {
  const id = typeof row.call_id === "string" ? row.call_id : "";
  const rawName = typeof row.name === "string" ? row.name : "tool";
  if (!id) return [];
  const status = typeof row.status === "string" ? row.status : "";
  const projected = unwrapCursorMcpTool(rawName, argsOf(row.args));
  if (status === "running") {
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
  if (status === "completed" || status === "error") {
    return [
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: id,
              content: stringifyResult(row.result),
              is_error: status === "error",
            },
          ],
        },
      },
    ];
  }
  return [];
}

export function resultMessageOf(settled: CursorRunResult, sessionId?: string): unknown {
  if (settled.status === "cancelled") {
    return {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "",
      errors: ["cancelled"],
      session_id: sessionId,
      usage: usageOf(settled),
      duration_ms: settled.durationMs,
      permission_denials: [],
    };
  }
  if (settled.status === "error") {
    const message = settled.error?.message || settled.error?.code || "Cursor agent failed";
    return {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: typeof settled.result === "string" ? settled.result : "",
      errors: [message],
      session_id: sessionId,
      usage: usageOf(settled),
      duration_ms: settled.durationMs,
      permission_denials: [],
    };
  }
  return {
    type: "result",
    subtype: "success",
    result: typeof settled.result === "string" ? settled.result : "",
    session_id: sessionId,
    usage: usageOf(settled),
    duration_ms: settled.durationMs,
    permission_denials: [],
  };
}

export function workerResultFromCursorMessage(message: unknown): WorkerResult | null {
  return resultFromSdkMessage(message);
}

function usageOf(settled: CursorRunResult): Record<string, number | undefined> {
  const usage = settled.usage ?? {};
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_read_input_tokens: usage.cacheReadTokens,
    cache_creation_input_tokens: usage.cacheWriteTokens,
  };
}

function argsOf(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/**
 * Cursor 把一切 MCP（含 AgentUp 与 customTools）收成元工具名 `mcp` +
 * `{ providerIdentifier, toolName, args }`。
 * 解包成与 CodeBuddy 同形的落盘 / UI 名，桌面才能走专用卡（委托 subagent 等）。
 *
 * - `custom-user-tools` / `agentup_ask_user` → `ask_user`
 * - `agentup` / `delegate_to_agent` 等 → `mcp__agentup__<tool>` + 扁平 args
 */
export function unwrapCursorMcpTool(
  name: string,
  args: Record<string, unknown>,
): { name: string; args: Record<string, unknown> } {
  if (name !== "mcp") return { name, args };
  const toolName = typeof args.toolName === "string" ? args.toolName.trim() : "";
  if (!toolName) return { name, args };
  const provider =
    typeof args.providerIdentifier === "string" ? args.providerIdentifier.trim() : "";
  const inner = flatMcpArgs(args);

  if (toolName === "agentup_ask_user" || provider === "custom-user-tools") {
    if (toolName === "agentup_ask_user") {
      if (Object.keys(inner).length > 0) return { name: "ask_user", args: inner };
      if (Array.isArray(args.questions)) return { name: "ask_user", args };
      return { name: "ask_user", args: {} };
    }
  }

  if (provider === "agentup") {
    return { name: `mcp__agentup__${toolName}`, args: inner };
  }

  return { name, args };
}

function flatMcpArgs(args: Record<string, unknown>): Record<string, unknown> {
  const inner = args.args;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return {};
}

/**
 * Cursor tool_call.result 常是 MCP 壳；落盘前抽正文，协助卡才不会整段 JSON。
 * 与桌面 unwrapSdkToolResultText 同形，供 CodeBuddy/Cursor 共用展示约定。
 */
export function stringifyCursorToolResult(raw: unknown): string {
  return unwrapMcpToolResultText(raw);
}

function stringifyResult(raw: unknown): string {
  return stringifyCursorToolResult(raw);
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
