import type { WorkerResult } from "../../contract.js";
import { resultFromSdkMessage } from "../../host/result.js";

export interface OpencodeQuestion {
  question: string;
  context?: string;
  options: Array<{ title: string; description?: string }>;
  allowMultiple: boolean;
}

interface StreamHooks {
  sessionId: string;
  onQuestion?: (input: {
    requestId: string;
    toolCallId: string;
    questions: OpencodeQuestion[];
  }) => Promise<string>;
  onPermission?: (requestId: string) => Promise<void>;
}

/** OpenCode SSE → Host 鸭子消息；只产 message_update/tool_execution 可消费的消息形。 */
export async function* mirrorOpencodeEvents(
  events: AsyncIterable<unknown>,
  hooks: StreamHooks,
): AsyncGenerator<unknown, void, undefined> {
  const textByPart = new Map<string, string>();
  const announcedTools = new Set<string>();
  const completedTools = new Set<string>();
  /** message.updated 登记 role；user / synthetic 正文绝不能当助手气泡 */
  const messageRoles = new Map<string, "user" | "assistant">();
  let usage: Record<string, number | undefined> | undefined;
  let terminal = false;

  yield { type: "system", subtype: "init", session_id: hooks.sessionId };

  for await (const event of events) {
    if (!event || typeof event !== "object") continue;
    const row = event as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type : "";
    // 兼容 { properties } 与部分 SDK 的 { data } 信封
    const properties = recordOf(row.properties ?? row.data);
    const eventSession =
      stringOf(properties.sessionID) || stringOf(recordOf(properties.part).sessionID);
    if (eventSession && eventSession !== hooks.sessionId) continue;

    if (type === "message.updated") {
      const info = recordOf(properties.info);
      const id = stringOf(info.id);
      const role = stringOf(info.role);
      if (id && (role === "user" || role === "assistant")) {
        messageRoles.set(id, role);
      }
      continue;
    }

    if (type === "message.part.updated") {
      const part = recordOf(properties.part);
      const partType = stringOf(part.type);
      const messageId = stringOf(part.messageID);
      const role = messageId ? messageRoles.get(messageId) : undefined;
      // 未登记 role 时保守：只跳过明确 user；synthetic/ignored 一律不当助手输出
      if (role === "user") continue;
      if (partType === "text" && (part.synthetic === true || part.ignored === true)) continue;

      if (partType === "text") {
        // 仍无 role 时：像「用户：」「助手：」的 transcript 回显视作用户侧，勿当助手正文
        if (!role && looksLikeTranscriptEcho(stringOf(part.text))) continue;
        const id = stringOf(part.id);
        const text = stringOf(part.text);
        const previous = textByPart.get(id) ?? "";
        const delta = text.startsWith(previous) ? text.slice(previous.length) : text;
        textByPart.set(id, text);
        if (delta) yield assistantText(delta);
      } else if (partType === "reasoning") {
        const id = stringOf(part.id);
        const text = stringOf(part.text);
        const previous = textByPart.get(id) ?? "";
        const delta = text.startsWith(previous) ? text.slice(previous.length) : text;
        textByPart.set(id, text);
        if (delta) yield thinkingDelta(delta);
      } else if (partType === "tool") {
        for (const message of projectToolPart(part, announcedTools, completedTools)) yield message;
      } else if (partType === "step-finish") {
        usage = usageOf(part.tokens);
      }
      continue;
    }

    if (type === "question.asked") {
      const requestId = stringOf(properties.id);
      const questions = opencodeQuestions(properties.questions);
      const toolCallId =
        stringOf(recordOf(properties.tool).callID) || requestId;
      if (!requestId || !toolCallId || questions.length === 0 || !hooks.onQuestion) continue;
      if (!announcedTools.has(toolCallId)) {
        announcedTools.add(toolCallId);
        yield toolUse(toolCallId, "ask_user", { questions });
      }
      try {
        const result = await hooks.onQuestion({ requestId, toolCallId, questions });
        yield toolResult(toolCallId, result, false);
      } catch (error) {
        yield toolResult(
          toolCallId,
          error instanceof Error ? error.message : "Ask user failed",
          true,
        );
      }
      continue;
    }

    if (type === "permission.asked") {
      const requestId = stringOf(properties.id);
      if (requestId && hooks.onPermission) await hooks.onPermission(requestId);
      continue;
    }

    if (type === "session.error") {
      terminal = true;
      yield resultMessage("error", hooks.sessionId, usage, errorMessage(properties.error));
      continue;
    }

    if (type === "session.idle") {
      terminal = true;
      yield resultMessage("success", hooks.sessionId, usage);
    }
  }

  if (!terminal) {
    yield resultMessage(
      "error",
      hooks.sessionId,
      usage,
      "OpenCode stream ended before session.idle",
    );
  }
}

export function opencodeQuestions(raw: unknown): OpencodeQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    const row = recordOf(value);
    const question = stringOf(row.question);
    if (!question) return [];
    const options = Array.isArray(row.options)
      ? row.options.flatMap((option) => {
          const item = recordOf(option);
          const title = stringOf(item.label);
          if (!title) return [];
          const description = stringOf(item.description);
          return [description ? { title, description } : { title }];
        })
      : [];
    return [{
      question,
      ...(stringOf(row.header) ? { context: stringOf(row.header) } : {}),
      options,
      allowMultiple: row.multiple === true,
    }];
  });
}

export function unwrapOpencodeTool(
  name: string,
  args: Record<string, unknown>,
): { name: string; args: Record<string, unknown> } {
  if (name.startsWith("mcp__agentup__")) return { name, args };
  if (name.startsWith("agentup_")) {
    return { name: `mcp__agentup__${name.slice("agentup_".length)}`, args };
  }
  return { name, args };
}

export function workerResultFromOpencodeMessage(message: unknown): WorkerResult | null {
  return resultFromSdkMessage(message);
}

function projectToolPart(
  part: Record<string, unknown>,
  announced: Set<string>,
  completed: Set<string>,
): unknown[] {
  const id = stringOf(part.callID) || stringOf(part.id);
  if (!id) return [];
  const state = recordOf(part.state);
  const status = stringOf(state.status);
  const projected = unwrapOpencodeTool(
    stringOf(part.tool) || "tool",
    toolInputOf(state),
  );
  const messages: unknown[] = [];
  const terminal = status === "completed" || status === "error";
  const inputReady = Object.keys(projected.args).length > 0;
  // OpenCode 常先推 pending/running 空 input，完成时才带齐参。
  // 空壳抢先 announce 后 translator 不再改 args → 协助 tab 丢 agent_id。
  if (
    !announced.has(id) &&
    (inputReady || terminal) &&
    ["pending", "running", "completed", "error"].includes(status)
  ) {
    announced.add(id);
    messages.push(toolUse(id, projected.name, projected.args));
  }
  if (status === "completed" && !completed.has(id)) {
    completed.add(id);
    messages.push(toolResult(id, stringifyToolResult(state.output), false));
  } else if (status === "error" && !completed.has(id)) {
    completed.add(id);
    messages.push(toolResult(id, stringOf(state.error) || "tool failed", true));
  }
  return messages;
}

/** OpenCode ToolState：input 可能是对象 / JSON 字符串；pending 另有 raw。 */
function toolInputOf(state: Record<string, unknown>): Record<string, unknown> {
  const fromInput = argsFromUnknown(state.input);
  if (Object.keys(fromInput).length > 0) return fromInput;
  return argsFromUnknown(state.raw);
}

function argsFromUnknown(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* 非 JSON 原文忽略 */
    }
  }
  return {};
}

function assistantText(text: string): unknown {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

function thinkingDelta(thinking: string): unknown {
  return {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking },
    },
  };
}

function toolUse(id: string, name: string, input: Record<string, unknown>): unknown {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name, input }],
    },
  };
}

function toolResult(id: string, content: string, isError: boolean): unknown {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }],
    },
  };
}

function resultMessage(
  subtype: "success" | "error",
  sessionId: string,
  usage?: Record<string, number | undefined>,
  error?: string,
): unknown {
  return {
    type: "result",
    subtype: subtype === "success" ? "success" : "error_during_execution",
    is_error: subtype === "error",
    result: "",
    ...(error ? { errors: [error] } : {}),
    session_id: sessionId,
    usage,
    permission_denials: [],
  };
}

function usageOf(raw: unknown): Record<string, number | undefined> | undefined {
  const tokens = recordOf(raw);
  if (Object.keys(tokens).length === 0) return undefined;
  const cache = recordOf(tokens.cache);
  return {
    input_tokens: numberOf(tokens.input),
    output_tokens: numberOf(tokens.output),
    cache_read_input_tokens: numberOf(cache.read),
    cache_creation_input_tokens: numberOf(cache.write),
  };
}

function stringifyToolResult(raw: unknown): string {
  return unwrapOpencodeToolResultText(raw);
}

/** 与 Cursor/Codex 同形：MCP `{content:[{text}]}` 抽正文，纯文本原样。 */
function unwrapOpencodeToolResultText(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return raw;
    try {
      return unwrapOpencodeToolResultText(JSON.parse(trimmed) as unknown) || raw;
    } catch {
      return raw;
    }
  }
  if (typeof raw !== "object") return String(raw);
  const row = raw as Record<string, unknown>;
  if (row.value && typeof row.value === "object" && !Array.isArray(row.value)) {
    const inner = unwrapOpencodeToolResultText(row.value);
    if (inner) return inner;
  }
  if (Array.isArray(row.content)) {
    const parts = row.content
      .map((item) => unwrapOpencodeContentBlock(item))
      .filter(Boolean);
    if (parts.length > 0) return parts.join("\n");
  }
  const block = unwrapOpencodeContentBlock(raw);
  if (block) return block;
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

function unwrapOpencodeContentBlock(item: unknown): string {
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

function errorMessage(raw: unknown): string {
  const row = recordOf(raw);
  const data = recordOf(row.data);
  return stringOf(data.message) || stringOf(row.message) || stringOf(row.name) || "OpenCode failed";
}

function recordOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function stringOf(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function numberOf(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/**
 * Host 投给 OpenCode 的 user prompt 形如「用户：… / 助手：…」；
 * 若 SSE 在 message.updated 之前就把该 text part 推回，用此前缀识别并丢弃。
 */
function looksLikeTranscriptEcho(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith("用户：") ||
    trimmed.startsWith("助手：") ||
    trimmed.startsWith("[会话上下文]") ||
    trimmed.startsWith("用户：[会话上下文]")
  );
}
