import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { Api, AssistantMessage } from "@earendil-works/pi-ai";

/**
 * 外部 Agent（本地 Agent App / SDK）的消息 → Pi `AgentSessionEvent`。
 *
 * 目的：路 2（.cursor/skills/agentup-sdk-adapter/references/overview.md §3）绕开 Pi 的 agent 循环，自己驱动外部 agent，
 * 但仍复用唯一的投影层 `PiUIMessageProjector`——桌面端因此零改动。
 *
 * 两条红线：
 * 1. 只合成**渲染用**事件（`message_update` / `tool_execution_*`），绝不合成 `toolcall_*`；
 *    后者在 Pi 的通道下会被当成"真的要去本地执行"，而外部 agent 的工具我们并没有。
 * 2. 消息形状按字段鸭子判断，不 import SDK 的类型定义（版本之间会变）。
 */

/** 工具摘要单行上限：回写隐藏上下文时够认出"干过什么"就行。 */
const DIGEST_CHARS = 200;

/** 落盘用：与 `projectHistory` 对齐的有序片段（text / tool）。 */
export type ExternalTrailItem =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      result?: unknown;
      isError?: boolean;
      done: boolean;
    };

export type ExternalTranslator = {
  /** 一条 SDK 消息 → 零到多个 Pi 事件；认不出来就返回空数组，绝不抛。 */
  push(message: unknown): AgentSessionEvent[];
  /** 为 SDK 未返回 tool_result 的工具补终态，避免 UI 永远停在“调用中”。 */
  finishOpenTools(result: string, isError?: boolean): AgentSessionEvent[];
  /**
   * 宿主侧补 tool 结果（如 AskUser 答题）：写入后 finishOpenTools / 晚到的 SDK tool_result 不再覆盖。
   */
  completeTool(toolCallId: string, result: unknown, isError?: boolean): AgentSessionEvent[];
  /** init 消息带来的外部 session id（只记，不展示）。 */
  readonly sessionId: string | undefined;
  readonly tools: string[];
  /** 本轮累计的正文（回写与失败兜底用）。 */
  readonly text: string;
  /** 本轮做过的工具调用，一行一条（隐藏上下文 / 排障）。 */
  readonly toolDigest: string[];
  /** 有序过程片段：结构化落盘用。 */
  readonly trail: ExternalTrailItem[];
};

/** 一条外部 agent 回合一个 translator：工具 id 去重等状态不能跨轮带。 */
export function createExternalTranslator(): ExternalTranslator {
  const tools: string[] = [];
  const toolDigest: string[] = [];
  const trail: ExternalTrailItem[] = [];
  /** 已发过 tool_execution_start 的 id：assistant 整包与 stream 事件会重复描述同一个工具。 */
  const announced = new Set<string>();
  /** 已切开旁白段的工具 id（含不进时间线的 ToolSearch），避免同 id 反复 reset。 */
  const segmentBreaks = new Set<string>();
  /** 参数还在流里的工具（content_block_start → delta → stop）。 */
  const building = new Map<
    number,
    { id: string; name: string; json: string; seed: Record<string, unknown> }
  >();
  const names = new Map<string, string>();
  const completed = new Set<string>();
  let sessionId: string | undefined;
  let text = "";
  /**
   * 自上次工具边界以来、已由 stream 或整包写入的「本段」旁白。
   * CodeBuddy / Claude：工具后 assistant 整包常只带本段（非全量累计），
   * 仅靠 piece === text / startsWith 去重会漏掉，导致同一句 message_update 双发。
   */
  let segment = "";

  const breakSegmentForTool = (id: string) => {
    if (!id || segmentBreaks.has(id)) return;
    segmentBreaks.add(id);
    segment = "";
  };

  const flush = (index: number): AgentSessionEvent[] => {
    const tool = building.get(index);
    if (!tool) return [];
    building.delete(index);
    // 有 input_json_delta 用流式 JSON；否则用 start 时自带的 input（有的 SDK 整包塞 start）。
    const args = tool.json.trim() ? parseArgs(tool.json) : tool.seed;
    return startTool(tool.id, tool.name, args);
  };

  const appendTextTrail = (piece: string) => {
    const last = trail[trail.length - 1];
    if (last?.kind === "text") {
      last.text += piece;
      return;
    }
    trail.push({ kind: "text", text: piece });
  };

  const startTool = (id: string, name: string, args: Record<string, unknown>): AgentSessionEvent[] => {
    if (!id) return [];
    // 工具切开旁白段（含跳过的 ToolSearch 壳）：其后 text 按「本段」计
    breakSegmentForTool(id);
    // 厂商壳：ToolSearch 不进时间线；DeferExecute 有底层名则展开，否则跳过空壳。
    if (name === "ToolSearch") {
      if (!announced.has(id)) {
        toolDigest.push(truncate(`${name}(${JSON.stringify(args)})`, DIGEST_CHARS));
      }
      return [];
    }
    const projected = projectVendorTool(name, args);
    if (!projected) {
      if (!announced.has(id)) {
        toolDigest.push(truncate(`${name}(${JSON.stringify(args)})`, DIGEST_CHARS));
      }
      return [];
    }
    // 已 announce：OpenCode 等可能先空壳后补参；只补 trail，避免协助卡丢 agent_id。
    if (announced.has(id)) {
      const item = trail.find(
        (entry): entry is Extract<ExternalTrailItem, { kind: "tool" }> =>
          entry.kind === "tool" && entry.id === id,
      );
      if (
        item &&
        Object.keys(item.args).length === 0 &&
        Object.keys(projected.args).length > 0
      ) {
        item.args = projected.args;
        item.name = projected.name;
        names.set(id, projected.name);
      }
      return [];
    }
    announced.add(id);
    names.set(id, projected.name);
    toolDigest.push(truncate(`${projected.name}(${JSON.stringify(projected.args)})`, DIGEST_CHARS));
    trail.push({
      kind: "tool",
      id,
      name: projected.name,
      args: projected.args,
      done: false,
    });
    return [
      {
        type: "tool_execution_start",
        toolCallId: id,
        toolName: projected.name,
        args: projected.args,
      },
    ];
  };

  const endTool = (
    id: string,
    result: unknown,
    isError: boolean,
  ): AgentSessionEvent[] => {
    if (!id || completed.has(id)) return [];
    // 未 announce 的（被跳过的 ToolSearch / 空壳）直接忽略
    if (!announced.has(id)) return [];
    completed.add(id);
    const item = trail.find(
      (entry): entry is Extract<ExternalTrailItem, { kind: "tool" }> =>
        entry.kind === "tool" && entry.id === id,
    );
    if (item) {
      item.result = result;
      item.isError = isError;
      item.done = true;
    }
    return [
      {
        type: "tool_execution_end",
        toolCallId: id,
        toolName: names.get(id) ?? "tool",
        result,
        isError,
      },
    ];
  };

  const push = (message: unknown): AgentSessionEvent[] => {
    const row = record(message);
    if (!row) return [];
    if (row.type === "system") {
      if (row.subtype === "init") {
        sessionId = text_(row.session_id) || sessionId;
        tools.push(...toolNamesOf(row.tools));
      }
      return [];
    }
    if (row.type === "stream_event") return fromStreamEvent(row.event);
    if (row.type === "assistant") return fromAssistant(row.message);
    // user 整包传入：tool_use_result 挂在外层，不在 message 里
    if (row.type === "user") return fromUser(row);
    return [];
  };

  const fromStreamEvent = (raw: unknown): AgentSessionEvent[] => {
    const event = record(raw);
    if (!event) return [];
    const index = number_(event.index) ?? 0;
    if (event.type === "content_block_start") {
      const block = record(event.content_block);
      if (block?.type !== "tool_use") return [];
      const id = text_(block.id);
      if (!id) return [];
      building.set(index, {
        id,
        name: text_(block.name) || "tool",
        json: "",
        seed: argsOf(block.input),
      });
      return [];
    }
    if (event.type === "content_block_delta") {
      const delta = record(event.delta);
      if (!delta) return [];
      if (delta.type === "text_delta") {
        const piece = text_(delta.text);
        if (!piece) return [];
        // 整包已先写入本段：stream 再推相同整块
        if (segment.length > 0 && piece === segment && text.endsWith(segment)) {
          return [];
        }
        const next = `${segment}${piece}`;
        // 累计正文已包含 next（逐块回放进已有后缀）
        if (text.endsWith(next)) {
          segment = next;
          return [];
        }
        segment = next;
        text += piece;
        appendTextTrail(piece);
        return [textUpdate(piece)];
      }
      if (delta.type === "thinking_delta") {
        const piece = text_(delta.thinking);
        return piece ? [thinkingUpdate(piece)] : [];
      }
      if (delta.type === "input_json_delta") {
        const tool = building.get(index);
        if (tool) tool.json += text_(delta.partial_json);
        return [];
      }
      return [];
    }
    if (event.type === "content_block_stop") return flush(index);
    return [];
  };

  /** 整包 assistant 消息：参数已齐全，直接发；跳过 stream 已推过的回放，保留工具间新旁白。 */
  const fromAssistant = (raw: unknown): AgentSessionEvent[] => {
    const blocks = contentBlocks(raw);
    const events: AgentSessionEvent[] = [];
    for (const block of blocks) {
      const item = record(block);
      if (!item) continue;
      if (item.type === "tool_use") {
        const id = text_(item.id);
        if (!id) continue;
        events.push(...startTool(id, text_(item.name) || "tool", argsOf(item.input)));
        continue;
      }
      if (item.type !== "text") continue;
      const piece = text_(item.text);
      if (!piece) continue;
      // 整包等于已累计正文：stream 回放，跳过
      if (piece === text) continue;
      // 整包等于本段 stream（工具后常见：assistant 只带本段，非全量）
      if (segment.length > 0 && piece === segment) continue;
      // 整包是 stream 前缀的超集：只推增量
      if (text.length > 0 && piece.startsWith(text)) {
        const delta = piece.slice(text.length);
        if (!delta) continue;
        text = piece;
        segment = piece;
        appendTextTrail(delta);
        events.push(textUpdate(delta));
        continue;
      }
      // 本段 stream 是整包前缀：只推差额
      if (segment.length > 0 && piece.startsWith(segment)) {
        const delta = piece.slice(segment.length);
        if (!delta) continue;
        segment = piece;
        text += delta;
        appendTextTrail(delta);
        events.push(textUpdate(delta));
        continue;
      }
      // 工具之间的新旁白（或首段无 stream 时的整包）
      text = text.length === 0 ? piece : `${text}${piece}`;
      segment = piece;
      appendTextTrail(piece);
      events.push(textUpdate(piece));
    }
    return events;
  };

  const fromUser = (raw: unknown): AgentSessionEvent[] => {
    const events: AgentSessionEvent[] = [];
    const row = record(raw);
    // CodeBuddy 等会在 user 消息顶层再挂一份 tool_use_result；content 空时用它兜底。
    const fallbackResult = row && "tool_use_result" in row ? row.tool_use_result : undefined;
    // content 在 message 里；也兼容直接传 message 对象的旧测例
    const blocks = contentBlocks(row?.message ?? raw);
    for (const block of blocks) {
      const item = record(block);
      if (!item || item.type !== "tool_result") continue;
      const id = text_(item.tool_use_id);
      if (!id) continue;
      const content = item.content;
      const empty =
        content === undefined ||
        content === null ||
        content === "" ||
        (Array.isArray(content) && content.length === 0);
      const result = empty && fallbackResult !== undefined ? fallbackResult : (content ?? "");
      events.push(...endTool(id, result, item.is_error === true));
    }
    return events;
  };

  const finishOpenTools = (result: string, isError = true): AgentSessionEvent[] => {
    const events: AgentSessionEvent[] = [];
    for (const id of announced) {
      events.push(...endTool(id, result, isError));
    }
    return events;
  };

  const completeTool = (
    toolCallId: string,
    result: unknown,
    isError = false,
  ): AgentSessionEvent[] => {
    return endTool(toolCallId.trim(), result, isError);
  };

  return {
    push,
    finishOpenTools,
    completeTool,
    get sessionId() {
      return sessionId;
    },
    get tools() {
      return [...tools];
    },
    get text() {
      return text;
    },
    get toolDigest() {
      return [...toolDigest];
    },
    get trail() {
      return trail.map((item) =>
        item.kind === "text"
          ? { ...item }
          : { ...item, args: { ...item.args } },
      );
    },
  };
}

/**
 * 厂商壳解包：DeferExecuteTool → 底层工具名 + params。
 * 返回 null 表示本步不进 UI 时间线。
 */
export function projectVendorTool(
  name: string,
  args: Record<string, unknown>,
): { name: string; args: Record<string, unknown> } | null {
  if (name !== "DeferExecuteTool") return { name, args };
  const nestedName = typeof args.toolName === "string" ? args.toolName.trim() : "";
  if (!nestedName) return null;
  const params = args.params;
  const nestedArgs =
    params && typeof params === "object" && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  return { name: nestedName, args: nestedArgs };
}

/** 外部没有流式事件、只有最终结果时，用它补一段正文（与流式通道同一形状）。 */
export function externalTextEvent(delta: string): AgentSessionEvent {
  return textUpdate(delta);
}

function textUpdate(delta: string): AgentSessionEvent {
  return {
    type: "message_update",
    message: shell(),
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta, partial: shell() },
  };
}

function thinkingUpdate(delta: string): AgentSessionEvent {
  return {
    type: "message_update",
    message: shell(),
    assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta, partial: shell() },
  };
}

/**
 * 事件壳：projector 只看 role / delta / toolName，但类型要求一条完整的 AssistantMessage。
 * 用量与 provider 都是占位（外部 agent 的用量走 result 消息另算）。
 */
function shell(): AssistantMessage {
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: "agentup-agent-sdk" as Api,
    provider: "agentup",
    model: "external-agent",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
  return message;
}

function parseArgs(json: string): Record<string, unknown> {
  if (!json.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return record(parsed) ?? {};
  } catch {
    // 参数没收全或不是 JSON：给它原始串，别把整轮搞挂
    return { raw: json };
  }
}

function argsOf(input: unknown): Record<string, unknown> {
  const row = record(input);
  if (row) return row;
  if (typeof input === "string") return parseArgs(input);
  return {};
}

function contentBlocks(raw: unknown): unknown[] {
  const message = record(raw);
  const content = message?.content;
  if (Array.isArray(content)) return content;
  // 有些版本直接把 content 数组放在消息外层
  return Array.isArray(raw) ? raw : [];
}

function toolNamesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text_(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number_(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}
