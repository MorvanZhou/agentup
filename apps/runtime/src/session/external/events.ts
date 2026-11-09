import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { Api, AssistantMessage } from "@earendil-works/pi-ai";

import { sanitizeToolResultForContext } from "../history/sanitize-tool-result.js";
import { TODO_TOOL } from "../tools/todo.js";
import type { ExternalTodoProjector } from "./sdk/contract.js";
import { emptyTodoBoard, type TodoBoard } from "./sdk/host/todo-board.js";

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
 *
 * Todo：Host 只消费 `ExternalTodoProjector`；厂商工具名在 `adapters/<driverId>/todo.ts`。
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

export type ExternalTranslatorOptions = {
  /** 本轮 driver 的 todo 投影；缺省不 rewrite 厂商 task/todo。 */
  todoProjector?: ExternalTodoProjector;
};

/** 一条外部 agent 回合一个 translator：工具 id 去重等状态不能跨轮带。 */
export function createExternalTranslator(
  options: ExternalTranslatorOptions = {},
): ExternalTranslator {
  const todoProjector = options.todoProjector;
  const tools: string[] = [];
  const toolDigest: string[] = [];
  const trail: ExternalTrailItem[] = [];
  /** 已发过 tool_execution_start 的 id：assistant 整包与 stream 事件会重复描述同一个工具。 */
  const announced = new Set<string>();
  /** 参数还在流里的工具（content_block_start → delta → stop）。 */
  const building = new Map<
    number,
    { id: string; name: string; json: string; seed: Record<string, unknown> }
  >();
  const names = new Map<string, string>();
  const completed = new Set<string>();
  /** 厂商 task/todo：启流记原名与参，收尾经 driver projector rewrite 成 Host todo。 */
  const pendingTodo = new Map<string, { vendorName: string; args: Record<string, unknown> }>();
  let todoBoard: TodoBoard = emptyTodoBoard();
  let sessionId: string | undefined;
  let text = "";
  /**
   * 当前 assistant 世代内，按 content block index 已吸收的文本快照。
   * CodeBuddy/Claude：`includePartialMessages` 下 stream_event 与 assistant 整包双通道；
   * 同一 index 可能先增量、再累计快照、再整包回放。按块 reconcile，绝不在工具边界清空
   *（旧 segment 清空会把同块 token 回放当成新旁白，截图那种 text+步骤成对重复）。
   * 世代在 user/tool_result 时复位，下一则旁白仍从 index 0 正常推出。
   */
  const blockText = new Map<number, string>();
  /** 同块在已有快照上的 token 级回放进度（重建前缀）；对不上就当新增量。 */
  const blockReplay = new Map<number, string>();

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

  /**
   * 吸收某一 content block 的文本：支持增量 delta、累计快照、同块 token 回放；
   * 只返回尚未发出的尾部。
   *
   * 另：stream 常把 thinking 占 index=0、text 在 index=1；assistant 终包常去掉 thinking，
   * text 落到 index=0。必须跨 index 按内容对齐，否则同一句会再开一个 text part。
   */
  const absorbBlockText = (index: number, piece: string): string | null => {
    if (!piece) return null;

    // 跨 index：已在其它块发过同一段 / 其超集 / 其前缀 → 对齐到本 index，不重复推
    for (const [otherIndex, other] of blockText) {
      if (otherIndex === index || !other) continue;
      if (other === piece) {
        blockText.set(index, piece);
        blockReplay.delete(index);
        return null;
      }
      if (piece.startsWith(other)) {
        const delta = piece.slice(other.length);
        blockText.set(otherIndex, piece);
        blockText.set(index, piece);
        blockReplay.delete(index);
        if (!delta) return null;
        text += delta;
        appendTextTrail(delta);
        return delta;
      }
      if (other.startsWith(piece)) {
        blockText.set(index, other);
        blockReplay.delete(index);
        return null;
      }
    }

    const prev = blockText.get(index) ?? "";
    if (piece === prev) {
      blockReplay.delete(index);
      return null;
    }
    // 累计快照 / 整包超集：只推新增尾部（prev="" 时整段都是增量）
    if (piece.startsWith(prev)) {
      blockReplay.delete(index);
      const delta = piece.slice(prev.length);
      blockText.set(index, piece);
      if (!delta) return null;
      text += delta;
      appendTextTrail(delta);
      return delta;
    }
    // 更短前缀：整包回退，或 token 回放的起点——记入 replay 供后续 token 拼接对齐
    if (prev.startsWith(piece)) {
      if (piece.length > 0) blockReplay.set(index, piece);
      else blockReplay.delete(index);
      return null;
    }
    // 已有块上继续 token 回放：拼到 prev 前缀则吞掉
    if (prev.length > 0) {
      const rebuild = `${blockReplay.get(index) ?? ""}${piece}`;
      if (prev.startsWith(rebuild)) {
        if (rebuild === prev) blockReplay.delete(index);
        else blockReplay.set(index, rebuild);
        return null;
      }
      blockReplay.delete(index);
    }
    // 普通增量 delta
    blockText.set(index, `${prev}${piece}`);
    text += piece;
    appendTextTrail(piece);
    return piece;
  };

  const emitText = (index: number, piece: string): AgentSessionEvent[] => {
    const delta = absorbBlockText(index, piece);
    return delta ? [textUpdate(delta)] : [];
  };

  const beginNextGeneration = () => {
    blockText.clear();
    blockReplay.clear();
    building.clear();
  };

  const startTool = (id: string, name: string, args: Record<string, unknown>): AgentSessionEvent[] => {
    if (!id) return [];
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
    // driver todoProjector 认领 → Host todo 名（落盘 / PlanDock）；原名与参留给 endTool。
    let announcedName = projected.name;
    let announcedArgs = projected.args;
    if (todoProjector?.ownsTool(projected.name)) {
      pendingTodo.set(id, { vendorName: projected.name, args: { ...projected.args } });
      announcedName = TODO_TOOL;
      announcedArgs = projected.args;
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
        Object.keys(announcedArgs).length > 0
      ) {
        item.args = announcedArgs;
        item.name = announcedName;
        names.set(id, announcedName);
        const pending = pendingTodo.get(id);
        if (pending) pending.args = { ...announcedArgs };
      }
      return [];
    }
    announced.add(id);
    names.set(id, announcedName);
    toolDigest.push(truncate(`${announcedName}(${JSON.stringify(announcedArgs)})`, DIGEST_CHARS));
    trail.push({
      kind: "tool",
      id,
      name: announcedName,
      args: announcedArgs,
      done: false,
    });
    return [
      {
        type: "tool_execution_start",
        toolCallId: id,
        toolName: announcedName,
        args: announcedArgs,
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
    let finalResult = result;
    let finalName = names.get(id) ?? "tool";
    const pending = pendingTodo.get(id);
    if (todoProjector && (pending || finalName === TODO_TOOL)) {
      const vendorName = pending?.vendorName ?? TODO_TOOL;
      const vendorArgs = pending?.args ?? item?.args ?? {};
      const applied = todoProjector.apply(todoBoard, vendorName, vendorArgs, result);
      todoBoard = applied.board;
      finalResult = isError ? result : applied.resultText;
      finalName = TODO_TOOL;
      names.set(id, TODO_TOOL);
      if (item) {
        item.name = TODO_TOOL;
        item.args = applied.hostArgs;
      }
      pendingTodo.delete(id);
    }
    // 媒体/超大载荷不进 trail：否则 writeBack 与 UI 过程卡都会拖着 base64
    finalResult = sanitizeToolResultForContext(finalResult);
    if (item) {
      item.result = finalResult;
      item.isError = isError;
      item.done = true;
    }
    return [
      {
        type: "tool_execution_end",
        toolCallId: id,
        toolName: finalName,
        result: finalResult,
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
        return emitText(index, text_(delta.text));
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

  /** 整包 assistant 消息：按 content 下标与 stream 块对齐 reconcile；跳过已推回放。 */
  const fromAssistant = (raw: unknown): AgentSessionEvent[] => {
    const blocks = contentBlocks(raw);
    const events: AgentSessionEvent[] = [];
    blocks.forEach((block, index) => {
      const item = record(block);
      if (!item) return;
      if (item.type === "tool_use") {
        const id = text_(item.id);
        if (!id) return;
        events.push(...startTool(id, text_(item.name) || "tool", argsOf(item.input)));
        return;
      }
      if (item.type !== "text") return;
      events.push(...emitText(index, text_(item.text)));
    });
    return events;
  };

  const fromUser = (raw: unknown): AgentSessionEvent[] => {
    const events: AgentSessionEvent[] = [];
    const row = record(raw);
    // CodeBuddy 等会在 user 消息顶层再挂一份 tool_use_result；content 空时用它兜底。
    const fallbackResult = row && "tool_use_result" in row ? row.tool_use_result : undefined;
    // content 在 message 里；也兼容直接传 message 对象的旧测例
    const blocks = contentBlocks(row?.message ?? raw);
    let sawToolResult = false;
    for (const block of blocks) {
      const item = record(block);
      if (!item || item.type !== "tool_result") continue;
      sawToolResult = true;
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
    // tool_result 结束本世代：下一段 stream/assistant 的 index 从 0 重计
    if (sawToolResult) beginNextGeneration();
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
