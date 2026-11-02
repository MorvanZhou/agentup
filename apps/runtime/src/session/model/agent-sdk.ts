import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Message,
  type Model,
  type Api,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";

import {
  installedCliPath,
  loadAgentSdkModule,
  type AgentSdkModule,
} from "../../config/providers/agent-sdk/loader.js";
import type { Visit } from "../../package/sync.js";
import type { WorkspacePolicy } from "../context/workspace-policy.js";
import {
  buildExternalAgentContext,
  type ExternalAgentContext,
} from "../external/context.js";
import { startExternalMcpServer, type ExternalMcpServer, type McpTool } from "../external/mcp/server.js";
import { syncSkillsProject } from "../external/skills-project.js";
import { agentSdkStateOf } from "../../config/provider/index.js";
import type {
  AskUserAnswer,
  AskUserQuestion,
} from "../tools/ask-user.js";
import {
  classifyAgentSdkFailure,
  markAgentSdkFailure,
  scrubSecrets,
  type AgentSdkFailureCode,
} from "./agent-sdk-failures.js";

/**
 * 本地 Agent App 的自定义 api 名。`model.api === 注册时的 api` 时 Pi 才会用我们的
 * streamSimple（见 `pi-coding-agent/dist/core/provider-composer.js` 的 streamWith）。
 * 与模板里的 `models[].api` 保持一致。
 */
export const AGENT_SDK_API = "agentup-agent-sdk";

/** 交付给外部 agent 的 prompt 上限：超了只留尾部，避免把整段历史都塞进去。 */
const MAX_PROMPT_CHARS = 60_000;
/** 最终结果按这个长度切块推 text_delta，长回答也能逐段渲染。 */
const DELTA_CHARS = 240;
/** 整回合上限：外部 agent 可能长时间不给结果，不能让用户一直干等（阶段 3）。 */
export const AGENT_SDK_TURN_TIMEOUT_MS = 10 * 60_000;

/** 归一的结果结构（docs/agent_cli §4.1），日后升级到 ②/③ 也用这个形状。 */
export interface WorkerResult {
  finalText: string;
  finishReason: "completed" | "max_tokens" | "error" | "aborted";
  sessionId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheRead?: number;
    cacheWrite?: number;
    durationMs?: number;
  };
  error?: { code: string; message: string };
  /** 被权限挡下的操作次数：结果旁要提示「有 N 个操作被跳过」，不能装作跑完了。 */
  permissionDenials: number;
  /** 外部 agent 自己跑了多少轮；订阅型不计费，只用于排障与未来回显。 */
  numTurns?: number;
}

/** 外部 SDK 的消息形态随版本变，一律按字段鸭子判断，不 import 它的类型。 */
export type SdkMessage = Record<string, unknown>;

/** 审批通道（ApprovalBroker 的最小面），没有它就一律拒绝工具。 */
export interface AgentSdkApprovalSink {
  request(
    request: {
      userId: string;
      agentId: string;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      /** session/agent 落盘键；厂商工具为 `{templateId}/{toolName}`。 */
      allowKey?: string;
    },
    signal?: AbortSignal,
  ): Promise<boolean | undefined>;
  /**
   * 已有授权查询（session / agent 级）：命中就不必再问用户。
   * 传入的已是持久化键（含 templateId 前缀或 MCP 原名）。
   * 可选——不提供时每次都问，行为同旧版。
   */
  allowsTool?(toolName: string): boolean;
}

/** SDK 的 AskUserQuestion 不是权限审批：宿主必须收集答案并回填 updatedInput.answers。 */
export interface AgentSdkAskUserSink {
  request(
    request: {
      userId: string;
      agentId: string;
      toolCallId: string;
      questions: AskUserQuestion[];
    },
    signal?: AbortSignal,
  ): Promise<AskUserAnswer>;
}

export type AgentSdkStreamContext = {
  userDataRoot: string;
  templateId: string;
  providerId: string;
  modelId: string;
  /** 外部 agent 的工作目录：与 AgentUp 的 visit cwd 对齐。 */
  cwd: string;
  approvals?: AgentSdkApprovalSink;
  askUser?: AgentSdkAskUserSink;
  userId?: string;
  agentId?: string;
  /** 整回合超时（毫秒）；测试与未来设置项可覆盖。 */
  turnTimeoutMs?: number;
  /** 会话所在 visit：用来拼外部 agent 的上下文（人设 / AGENTS.md / 挂载目录）。 */
  visit?: Visit;
  /** 目录能力必须沿用当前会话策略，群聊不能回落为成员私聊策略。 */
  workspacePolicy?: WorkspacePolicy;
  groupId?: string;
  groupWorkspaceRoot?: string;
  /** 会话名（展示在 append 里）。 */
  agentName?: string;
  /** 群执掌 `# Group members` 块；有则 SDK 走群协议而非单聊 agent_search。 */
  groupRosterPrompt?: string;
  /**
   * 交给外部 agent 的 MCP 工具（委托协调，§12.7）。技能走方案 D 目录投影，不经 MCP。
   * 子会话不传，天然形成"不再委派"的嵌套围栏。
   */
  mcpTools?: McpTool[];
};

export type AgentSdkStreamSimple = (
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

const ERROR_TEXT: Record<string, string> = {
  error_during_execution: "外部 agent 执行出错",
  error_max_turns: "外部 agent 达到轮次上限",
  error_max_budget_usd: "外部 agent 达到预算上限",
};

/** 最近几轮保留原文（一轮 = 一条用户消息 + 它之后的助手/工具结果）。 */
export const DEFAULT_RECENT_TURNS = 6;
/** 更早的消息每条压成多长的一行摘要。 */
const DEFAULT_DIGEST_CHARS = 120;

export type TranscriptPromptOptions = {
  maxChars?: number;
  recentTurns?: number;
  digestChars?: number;
};

/**
 * 把 transcript 折成一段任务描述：丢掉 Pi 的系统提示，只留对话本身。
 * 分层重放（docs/agent_cli §12.5）：最近 N 轮原文 + 更早的一行摘要；
 * 超预算先丢更早的摘要并**明说省略了几条**，绝不静默把开头切掉。
 */
export function transcriptToPrompt(
  messages: readonly Message[],
  options: TranscriptPromptOptions = {},
): string {
  const maxChars = options.maxChars ?? MAX_PROMPT_CHARS;
  const recentTurns = options.recentTurns ?? DEFAULT_RECENT_TURNS;
  const digestChars = options.digestChars ?? DEFAULT_DIGEST_CHARS;

  const splitAt = recentTurnStartIndex(messages, recentTurns);
  const recent = messages
    .slice(splitAt)
    .map(messageToLine)
    .filter((line): line is string => line !== null);
  let digest = messages
    .slice(0, splitAt)
    .map((message) => digestLine(message, digestChars))
    .filter((line): line is string => line !== null);

  const joinWith = (digestLines: string[]): string => {
    const head =
      digestLines.length > 0 ? ["以下是更早对话的摘要（原文未展开）：", ...digestLines, "---"] : [];
    return [...head, ...recent].join("\n");
  };

  let dropped = 0;
  let text = joinWith(digest);
  // 先砍更早的摘要（从最旧开始），最近几轮原文尽量不动
  while (text.length > maxChars && digest.length > 0) {
    digest = digest.slice(1);
    dropped += 1;
    text = joinWith(digest);
  }
  // 逼不得已才动最近原文：留尾部
  if (text.length > maxChars) text = `…${text.slice(-(maxChars - 1))}`;
  const notice = dropped > 0 ? `（已省略更早 ${dropped} 条消息，需要回顾请说）\n` : "";
  return `${notice}${text}`;
}

/** 最近 N 轮的起点：从末尾往前数第 N 条用户消息。 */
function recentTurnStartIndex(messages: readonly Message[], turns: number): number {
  if (turns <= 0) return 0;
  let seen = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role === "user") {
      seen += 1;
      if (seen === turns) return index;
    }
  }
  return 0;
}

/** 更早的消息压成一行：够模型知道"聊过什么"就行。 */
function digestLine(message: Message, digestChars: number): string | null {
  const line = messageToLine(message);
  if (!line) return null;
  return line.length <= digestChars ? line : `${line.slice(0, digestChars)}…`;
}

function messageToLine(message: Message): string | null {
  if (message.role === "system") {
    // Pi 的系统提示里是 AgentUp 的工具清单与路径，喂给外部 agent 只会误导它
    return null;
  }
  if (message.role === "user") {
    return `用户：${contentToText(message.content)}`;
  }
  if (message.role === "assistant") {
    const parts = message.content.map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "toolCall") return `[调用工具 ${block.name}]`;
      return "";
    });
    const text = parts.filter((item) => item.length > 0).join("");
    return text ? `助手：${text}` : null;
  }
  return `工具结果（${message.toolName}）：${contentToText(message.content)}`;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const row = block as { type?: string; text?: string };
      if (row?.type === "text") return row.text ?? "";
      if (row?.type === "image") return "[图片]";
      return "";
    })
    .filter((item) => item.length > 0)
    .join("\n");
}

/** `ResultMessage` → `WorkerResult`；非 result 消息返回 null。 */
export function resultFromSdkMessage(message: unknown): WorkerResult | null {
  if (!message || typeof message !== "object") return null;
  const row = message as SdkMessage;
  if (row.type !== "result") return null;
  const subtype = typeof row.subtype === "string" ? row.subtype : "success";
  const sessionId = typeof row.session_id === "string" ? row.session_id : undefined;
  const usage = usageOf(row.usage, row.duration_ms);
  const permissionDenials = Array.isArray(row.permission_denials) ? row.permission_denials.length : 0;
  const resultText = typeof row.result === "string" ? row.result : "";

  if (subtype === "success") {
    return {
      finalText: resultText,
      finishReason: "completed",
      sessionId,
      usage,
      permissionDenials,
      numTurns: numberOf(row.num_turns),
    };
  }
  const reasons = Array.isArray(row.errors)
    ? row.errors.filter((item): item is string => typeof item === "string").join("；")
    : "";
  const text = reasons || ERROR_TEXT[subtype] || "外部 agent 执行失败";
  return {
    finalText: resultText || text,
    finishReason: subtype === "error_max_turns" ? "max_tokens" : "error",
    sessionId,
    usage,
    error: { code: subtype, message: text },
    permissionDenials,
  };
}

function usageOf(raw: unknown, durationMs: unknown): WorkerResult["usage"] {
  const row = (raw ?? {}) as SdkMessage;
  return {
    inputTokens: numberOf(row.input_tokens),
    outputTokens: numberOf(row.output_tokens),
    cacheRead: numberOf(row.cache_read_input_tokens),
    cacheWrite: numberOf(row.cache_creation_input_tokens),
    durationMs: numberOf(durationMs),
  };
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * 一条自定义的 `streamSimple`：整个回合外包给本地 Agent App，只把最终结果
 * 折成一条 assistant 回答（docs/agent_cli §3.2 / §4.3）。
 */
export function createAgentSdkStreamSimple(ctx: AgentSdkStreamContext): AgentSdkStreamSimple {
  // 本地 SDK 是动态 import，一次会话只加载一次
  let pending: ReturnType<typeof loadAgentSdkModule> | null = null;
  const load = (): ReturnType<typeof loadAgentSdkModule> =>
    (pending ??= loadAgentSdkModule(ctx.userDataRoot, ctx.templateId));

  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const partial: AssistantMessage = baseMessage(model, ctx, {
      finalText: "",
      finishReason: "completed",
      permissionDenials: 0,
    });
    partial.content = [];
    partial.stopReason = "pending";
    stream.push({ type: "start", partial: { ...partial } });
    void run(model, context, options, stream, partial);
    return stream;
  };

  async function run(
    model: Model<Api>,
    context: TranscriptContext,
    options: SimpleStreamOptions | undefined,
    stream: AssistantMessageEventStream,
    partial: AssistantMessage,
  ): Promise<void> {
    const controller = new AbortController();
    const signal = options?.signal;
    const onAbort = () => controller.abort();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    // 到点自己掐断：外部 agent 可能长时间不给结果，不能让用户干等。
    // 与迭代赛跑而不是只靠 abort——有些 SDK 被 abort 后迭代器不一定 reject。
    const timeoutMs = ctx.turnTimeoutMs ?? AGENT_SDK_TURN_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    let mcp: OpenedExternalMcp | null = null;
    try {
      // 先问本机状态：没装 / 没登录就不必去调外部 agent，直接给用户下一步
      const state = agentSdkStateOf(ctx.userDataRoot, ctx.templateId);
      if (state && state !== "ready") {
        finish(
          stream,
          partial,
          failureResult(classifyAgentSdkFailure("", state), `当前状态：${state}`),
          model,
          ctx,
        );
        return;
      }
      const module = await load();
      if (typeof module.query !== "function") throw new Error("本地 Agent App 不支持 query()");
      // 本轮专用 MCP（委托 + 技能读取）：起不来就退化成"没有这些工具"
      mcp = await openExternalMcp(ctx);
      const iterable = module.query!({
        prompt: transcriptToPrompt(context.messages),
        options: sdkOptions(ctx, controller, mcp?.clientConfig),
      });
      let result: WorkerResult | null = null;
      const iterate = (async () => {
        for await (const message of iterable) {
          result = resultFromSdkMessage(message);
          if (result) break;
        }
      })();
      const winner = await Promise.race([iterate.then(() => "done" as const), guard]);
      if (winner === "timeout") {
        controller.abort();
        closeIterable(iterable);
        finish(stream, partial, failureResult("timeout", `${Math.round(timeoutMs / 60_000)} 分钟`), model, ctx);
        return;
      }
      // 用户中途停了就算停了：SDK 就算照常返回，也不能当作成功
      if (signal?.aborted) {
        finish(stream, partial, { finalText: "", finishReason: "aborted", permissionDenials: 0 }, model, ctx);
        return;
      }
      // 闭包里赋的值 TS 追不到（会把它窄化成 null），显式断言回来
      const found = result as WorkerResult | null;
      if (found && found.finishReason === "error") {
        // ResultMessage 的错误已分好类：把原因码带上，UI 才说得清「该怎么办」
        finish(
          stream,
          partial,
          { ...found, error: classifyError(found) },
          model,
          ctx,
        );
        return;
      }
      finish(
        stream,
        partial,
        found ?? failureResult("unknown", "外部 agent 没有返回结果"),
        model,
        ctx,
      );
    } catch (error) {
      const aborted = Boolean(signal?.aborted) || isAbort(error);
      if (aborted) {
        // 用户自己停的：不写 errorMessage，交给桌面的「已停止」态
        finish(stream, partial, { finalText: "", finishReason: "aborted", permissionDenials: 0 }, model, ctx);
        return;
      }
      finish(
        stream,
        partial,
        failureResult(classifyAgentSdkFailure(textOf(error)), textOf(error)),
        model,
        ctx,
      );
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      // 端口不留：回合结束就收掉本轮 MCP 端点
      void mcp?.close().catch(() => undefined);
    }
  }
}

export type ExternalAgentQuery = {
  /** 外部 agent 的消息流：交给 `runExternalTurn` 消费（§12.6 路 2）。 */
  iterable: AsyncIterable<unknown>;
  controller: AbortController;
  timeoutMs: number;
  /** 收尾关掉本轮 MCP 端点；没有 MCP 时是 no-op。 */
  close?: () => Promise<void>;
};

/**
 * 路 2（§12.6）的入口：只负责"把流起起来"，不处理结果——结果由 `runExternalTurn`
 * 投影成 UI chunk。失败一律抛出，交给调用方决定是否回落到 P1（走 Pi 的 streamSimple）。
 */
export async function queryExternalAgent(
  ctx: AgentSdkStreamContext,
  prompt: string,
  overrides: { loadModule?: (userDataRoot: string, templateId: string) => Promise<AgentSdkModuleLike> } = {},
): Promise<ExternalAgentQuery> {
  const state = agentSdkStateOf(ctx.userDataRoot, ctx.templateId);
  if (state && state !== "ready") throw new Error(`本地 Agent App 当前状态：${state}`);
  const load = overrides.loadModule ?? loadAgentSdkModule;
  const module = await load(ctx.userDataRoot, ctx.templateId);
  if (typeof module.query !== "function") throw new Error("本地 Agent App 不支持 query()");
  const controller = new AbortController();
  const mcp = await openExternalMcp(ctx);
  return {
    iterable: module.query!({ prompt, options: sdkOptions(ctx, controller, mcp?.clientConfig) }),
    controller,
    timeoutMs: ctx.turnTimeoutMs ?? AGENT_SDK_TURN_TIMEOUT_MS,
    close: mcp?.close,
  };
}

export type OpenedExternalMcp = {
  /** 直接塞进 `sdkOptions.mcpServers` 的那一项。 */
  clientConfig: Record<string, unknown>;
  close: () => Promise<void>;
};

/**
 * 起一轮专用的 MCP 端点：只监听 127.0.0.1 + 随机 token，回合结束就关（§12.7）。
 * 起不来不算致命：没有委托与技能读取，外部 agent 照样能干活。
 */
export async function openExternalMcp(ctx: AgentSdkStreamContext): Promise<OpenedExternalMcp | null> {
  if (!ctx.mcpTools || ctx.mcpTools.length === 0) return null;
  try {
    const server = await startExternalMcpServer({ tools: ctx.mcpTools, serverName: "agentup" });
    return {
      clientConfig: { type: "http", url: server.url, headers: server.headers },
      close: () => server.close().catch(() => undefined),
    };
  } catch (error) {
    console.error(`[runtime] 外部 agent 的 MCP 通道没起来：${textOf(error)}`);
    return null;
  }
}

/** 与 `AgentSdkModule` 同形但只取 query，便于测试注入假模块。 */
export type AgentSdkModuleLike = { query?: NonNullable<AgentSdkModule["query"]> };

/** 尽力关掉外部 agent 的迭代器（收掉子进程）；它不响应也不能连累我们。 */
function closeIterable(iterable: AsyncIterable<unknown>): void {
  try {
    const closer = (iterable as { return?: () => Promise<unknown> | undefined }).return;
    void Promise.resolve(closer?.call(iterable)).catch(() => undefined);
  } catch {
    // 关不掉就算了：abort 已经发过
  }
}

/** 分类后的失败结果：errorMessage 带标记，展示层去标记后换成用户文案。 */
function failureResult(code: AgentSdkFailureCode, detail: string): WorkerResult {
  return {
    finalText: "",
    finishReason: "error",
    permissionDenials: 0,
    error: { code, message: markAgentSdkFailure(code, detail) },
  };
}

function classifyError(result: WorkerResult): WorkerResult["error"] {
  const code = classifyAgentSdkFailure(result.error?.message ?? "");
  return { code, message: markAgentSdkFailure(code, result.error?.message ?? "") };
}

function finish(
  stream: AssistantMessageEventStream,
  partial: AssistantMessage,
  result: WorkerResult,
  model: Model<Api>,
  ctx: AgentSdkStreamContext,
): void {
  if (result.permissionDenials > 0) {
    // 被挡下的操作不会让任务失败，模型通常会在结果里带一句；这里留个排障痕迹
    console.error(`[runtime] 外部 agent 有 ${result.permissionDenials} 个操作未获授权被跳过`);
  }
  if (result.finishReason === "completed") {
    // 订阅型不计费（cost 恒 0），用量目前只落到日志：桌面上还没有消费它的地方
    const total = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
    console.error(
      `[runtime] 本地 Agent App 本轮：${result.numTurns ?? "?"} 轮 / ${total} tokens / ${result.usage?.durationMs ?? "?"} ms`,
    );
  }
  const message = baseMessage(model, ctx, result);
  message.stopReason =
    result.finishReason === "completed"
      ? "stop"
      : result.finishReason === "max_tokens"
        ? "length"
        : result.finishReason;
  if (result.error) message.errorMessage = result.error.message;
  if (result.sessionId) message.responseId = result.sessionId;

  if (result.finishReason === "error" || result.finishReason === "aborted") {
    stream.push({ type: "error", reason: result.finishReason, error: message });
    stream.end(message);
    return;
  }
  const block = { type: "text" as const, text: "" };
  partial.content = [block];
  stream.push({
    type: "text_start",
    contentIndex: 0,
    partial: { ...partial, content: [{ ...block }] },
  });
  for (const chunk of splitChunks(result.finalText)) {
    block.text += chunk;
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: chunk,
      partial: { ...partial, content: [{ ...block }] },
    });
  }
  stream.push({
    type: "text_end",
    contentIndex: 0,
    content: block.text,
    partial: { ...partial, content: [{ ...block }] },
  });
  stream.push({ type: "done", reason: message.stopReason as "stop" | "length", message });
  stream.end(message);
}

function baseMessage(
  model: Model<Api>,
  ctx: AgentSdkStreamContext,
  result: WorkerResult,
): AssistantMessage {
  const usage = result.usage ?? {};
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  return {
    role: "assistant",
    content: result.finalText ? [{ type: "text", text: result.finalText }] : [],
    api: model.api,
    provider: ctx.providerId,
    model: ctx.modelId,
    usage: {
      input,
      output,
      cacheRead,
      cacheWrite,
      totalTokens: input + output + cacheRead + cacheWrite,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function externalContextOf(ctx: AgentSdkStreamContext): ExternalAgentContext | null {
  if (!ctx.visit) return null;
  try {
    // 每轮再 sync 一次：会话中途换 templateId（重建 Slot）时厂商路径会跟着换。
    const projected = syncSkillsProject({
      cwd: ctx.cwd,
      templateId: ctx.templateId,
      visit: ctx.visit,
      userDataRoot: ctx.userDataRoot,
    });
    return buildExternalAgentContext({
      visit: ctx.visit,
      cwd: ctx.cwd,
      userDataRoot: ctx.userDataRoot,
      ...(ctx.workspacePolicy ? { policy: ctx.workspacePolicy } : {}),
      ...(ctx.groupId ? { groupId: ctx.groupId } : {}),
      ...(ctx.groupWorkspaceRoot ? { groupWorkspaceRoot: ctx.groupWorkspaceRoot } : {}),
      ...(ctx.agentName ? { agentName: ctx.agentName } : {}),
      ...(projected.rel ? { skillsProjectRel: projected.rel } : {}),
      ...(ctx.groupRosterPrompt ? { groupRoster: ctx.groupRosterPrompt } : {}),
    });
  } catch {
    // 上下文拼不出来就退回"只给 cwd"：宁可少说，也别把整轮搞挂
    return null;
  }
}

function sdkOptions(
  ctx: AgentSdkStreamContext,
  controller: AbortController,
  mcpServer?: Record<string, unknown>,
): Record<string, unknown> {
  // 「default」是模板占位模型，传下去外部 agent 会找不到模型
  const model = ctx.modelId && ctx.modelId !== "default" ? { model: ctx.modelId } : {};
  const cli = installedCliPath(ctx.userDataRoot, ctx.templateId);
  // 上下文拼接只影响"它知道些什么"：读文件失败不该让整轮崩掉
  const external = externalContextOf(ctx);
  return {
    abortController: controller,
    cwd: ctx.cwd,
    ...(external?.systemAppend ? { systemPrompt: { append: external.systemAppend } } : {}),
    ...(external && external.additionalDirs.length > 0
      ? { additionalDirectories: external.additionalDirs }
      : {}),
    // SDK 信任模式（跨厂商共用）：bypass + canUseTool 恒 allow。
    // 不按家定制 deferred / updatedPermissions；选模板时桌面已提示风险。
    // AskUserQuestion 仍走提问通道，与工具审批无关。
    permissionMode: "bypassPermissions",
    canUseTool: canUseToolOf(ctx),
    // 打开 stream_event：否则 SDK 会丢掉 text_delta / 工具参数流，中间旁白与工具卡只能等整包。
    includePartialMessages: true,
    // 上下文永远由 runtime 拼接（§12.5）：不 resume，也不让它把对话落到自己那份
    // `<config-dir>/projects/`——那在我们 users/<uid>/ 之外，等于多一份管不到的副本。
    persistSession: false,
    ...model,
    ...(cli ? { pathToCodebuddyCode: cli } : {}),
    ...(mcpServer ? { mcpServers: { agentup: mcpServer } } : {}),
  };
}

/**
 * SDK 工具闸：信任模式下写 / 执行 / MCP 一律放行，不弹 HITL。
 * 只拦截 AskUserQuestion → 提问 broker（那是问卷，不是权限）。
 */
function canUseToolOf(ctx: AgentSdkStreamContext) {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    options: { toolUseID?: string; signal?: AbortSignal },
  ): Promise<
    | { behavior: "allow"; updatedInput?: Record<string, unknown> }
    | { behavior: "deny"; message: string }
  > => {
    if (toolName === "AskUserQuestion") {
      return askUserQuestion(ctx, input, options);
    }
    return { behavior: "allow" };
  };
}

async function askUserQuestion(
  ctx: AgentSdkStreamContext,
  input: Record<string, unknown>,
  options: { toolUseID?: string; signal?: AbortSignal },
): Promise<
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string }
> {
  if (!ctx.askUser || !ctx.userId || !ctx.agentId) {
    return { behavior: "deny", message: "当前没有可提问的通道" };
  }
  const questions = sdkAskUserQuestions(input.questions);
  if (!questions) return { behavior: "deny", message: "提问参数无效" };
  const answer = await ctx.askUser.request(
    {
      userId: ctx.userId,
      agentId: ctx.agentId,
      toolCallId: options.toolUseID || "sdk-ask-user",
      questions,
    },
    options.signal,
  );
  if (answer.kind === "cancelled") {
    return { behavior: "deny", message: "用户取消了提问" };
  }
  const answers: Record<string, string> = {};
  for (let index = 0; index < questions.length; index += 1) {
    const item = answer.items[index];
    if (!item || item.kind === "skipped") continue;
    answers[questions[index]!.question] =
      item.kind === "freeform" ? item.text : item.selections.join(", ");
  }
  return { behavior: "allow", updatedInput: { ...input, answers } };
}

function sdkAskUserQuestions(raw: unknown): AskUserQuestion[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const questions: AskUserQuestion[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const question = typeof row.question === "string" ? row.question.trim() : "";
    if (!question || !Array.isArray(row.options)) return null;
    const options = row.options.flatMap((option) => {
      if (!option || typeof option !== "object" || Array.isArray(option)) return [];
      const item = option as Record<string, unknown>;
      const title = typeof item.label === "string" ? item.label.trim() : "";
      if (!title) return [];
      const description =
        typeof item.description === "string" && item.description.trim()
          ? item.description.trim()
          : undefined;
      return [description ? { title, description } : { title }];
    });
    if (options.length === 0) return null;
    const context =
      typeof row.header === "string" && row.header.trim() ? row.header.trim() : undefined;
    questions.push({
      question,
      ...(context ? { context } : {}),
      options,
      allowMultiple: row.multiSelect === true,
    });
  }
  return questions;
}

function splitChunks(text: string): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += DELTA_CHARS) {
    chunks.push(text.slice(index, index + DELTA_CHARS));
  }
  return chunks;
}

function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "AbortError";
}

function textOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "外部 agent 调用失败";
}
