import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { UIMessageChunk } from "ai";

import type { ModelConfig } from "../../config/load.js";
import type { UiLocale } from "../../i18n/locale.js";
import type { DelegationStartedEvent } from "../delegation/progress.js";
import {
  createExternalTranslator,
  externalTextEvent,
  type ExternalTrailItem,
} from "../external/events.js";
import type { ExternalTodoProjector } from "../external/sdk/contract.js";
import { PiUIMessageProjector } from "../history/frames.js";
import {
  AGENTUP_REPLY_MODEL_CUSTOM_TYPE,
  replyModelFromConfig,
  type AgentUpReplyModel,
} from "../history/reply-model.js";
import { AGENTUP_SUMMARY_CUSTOM_TYPE } from "../history/summary.js";
import type { ApprovalRequest } from "../hitl/approval/types.js";
import {
  feedMessagesFromBranch,
  maybeCompactBranch,
  resultFromSdkMessage,
  transcriptToPrompt,
  type WorkerResult,
} from "../model/agent-sdk.js";
import { assistantFailureNotice } from "../model/unavailable.js";
import { sanitizeToolResultForContext } from "../history/sanitize-tool-result.js";
import { sanitizeStreamText } from "../stream-guard.js";
import type { AskUserRequest, AskUserResolved } from "../tools/ask-user.js";
import type { TurnErrorPolicy, TurnHitlLabel } from "./turn-runner.js";
import type { PromptSession } from "./types.js";

/**
 * 外部 Agent（本地 Agent App / SDK）的回合驱动 —— .cursor/skills/agentup-sdk-adapter/references/overview.md §3 的「路 2」。
 *
 * 与 `runObservedTurn` 同形：同样的 `write` / HITL 订阅 / 错误策略，桌面端零改动；
 * 区别只是事件来源不是 Pi 的 `session.subscribe`，而是外部 agent 的消息流经
 * `external/events.ts` 合成的 Pi 事件。
 *
 * ⚠️ 隐藏成本（§12.6 第 4 条）：绕过 Pi 后 session 里不会自动有 assistant 条目，
 * 所以收尾必须 `writeBack` 把**结构化过程**写回会话，否则重载只剩扁文本、丢多 tab。
 */

type ExternalHitlIdentity = {
  userId: string;
  agentId: string;
  origin?: "visit" | "delegation";
  parentAgentId?: string;
  taskId?: string;
  groupId?: string;
};

export type ExternalTurnInput = {
  /** 外部 agent 的消息流（`query()` 的返回值）。 */
  source: AsyncIterable<unknown>;
  signal?: AbortSignal;
  /**
   * 流空闲超时（毫秒）：两次 SDK 消息之间的最长等待。
   * 每收到一条消息就续命，整轮可长跑；不是墙钟总时长。
   */
  timeoutMs?: number;
  /** 空闲超时或用户停止时打断厂商（abort session / 关流） */
  onTimeout?: () => void;
  write: (chunks: UIMessageChunk[]) => void;
  locale?: UiLocale | string | null;
  errorPolicy: TurnErrorPolicy;
  outcome?: { aborted: boolean };
  onDirty?: () => void;
  hitl?: {
    accept: (request: ExternalHitlIdentity) => boolean;
    label?: (request: { origin?: string; taskId?: string }) => TurnHitlLabel;
    approvals?: { subscribe: (listener: (request: ApprovalRequest) => void) => () => void };
    askUser?: {
      subscribe: (listener: (request: AskUserRequest) => void) => () => void;
      /** 答题后立刻投影 tool result（与 Pi ask_user 同形文案）。 */
      subscribeResolved?: (listener: (event: AskUserResolved) => void) => () => void;
    };
  };
  /** 与 runObservedTurn 同形：委托启动 → 协助条 / 过程弹窗。 */
  delegationStarted?: {
    accept: (event: DelegationStartedEvent) => boolean;
    subscribe: (listener: (event: DelegationStartedEvent) => void) => () => void;
  };
  /** 收尾回写：结构化过程 + 可见正文（无 toolDigest 长尾）。 */
  writeBack?: (input: {
    text: string;
    toolDigest: string[];
    trail: ExternalTrailItem[];
    aborted: boolean;
  }) => void;
  /** 本轮回复模型；写入流式 start metadata。 */
  replyModel?: AgentUpReplyModel;
  /** 本轮 driver 的 todo 投影（来自 ExternalAgentQuery）。 */
  todoProjector?: ExternalTodoProjector;
};

export type ExternalTurnResult = {
  /** 用户实际看到的正文（流式累计，不含工具输出）。 */
  visibleText: string;
  result: WorkerResult | null;
  aborted: boolean;
};

export async function runExternalTurn(input: ExternalTurnInput): Promise<ExternalTurnResult> {
  const projector = new PiUIMessageProjector({
    replyModel: input.replyModel,
  });
  const translator = createExternalTranslator(
    input.todoProjector ? { todoProjector: input.todoProjector } : {},
  );
  let visibleText = "";
  let result: WorkerResult | null = null;
  let aborted = input.signal?.aborted === true;
  let timedOut = false;
  let lastDirtyAt = 0;

  const unsubscribeApproval = input.hitl?.approvals?.subscribe((request) => {
    if (!input.hitl?.accept(request)) return;
    input.write(
      projector.approval({
        id: request.id,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        args: request.args,
        ...(input.hitl?.label?.(request) ?? {}),
      }),
    );
  });
  const unsubscribeDelegationStarted = input.delegationStarted?.subscribe((event) => {
    if (!input.delegationStarted?.accept(event)) return;
    input.write(
      projector.delegationStarted({
        taskId: event.taskId,
        toolCallId: event.toolCallId,
        toAgentId: event.toAgentId,
        toAgentName: event.toAgentName,
        brief: event.brief,
        wait: event.wait,
        ...(event.replyModel ? { replyModel: event.replyModel } : {}),
      }),
    );
  });
  const markDirty = (event: AgentSessionEvent) => {
    if (!input.onDirty) return;
    if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
      lastDirtyAt = Date.now();
      input.onDirty();
      return;
    }
    if (Date.now() - lastDirtyAt > 800) {
      lastDirtyAt = Date.now();
      input.onDirty();
    }
  };
  const finishOpenTools = (reason: string, isError = true) => {
    for (const event of translator.finishOpenTools(reason, isError)) {
      markDirty(event);
      input.write(projector.project(event));
    }
  };
  const unsubscribeAskUser = input.hitl?.askUser?.subscribe((request) => {
    if (!input.hitl?.accept(request)) return;
    input.write(
      projector.askUser({
        id: request.id,
        toolCallId: request.toolCallId,
        questions: request.questions,
        ...(input.hitl?.label?.(request) ?? {}),
      }),
    );
  });
  // 用户答完：立刻写入 tool result，避免收尾占位被 summarize 成假「已跳过」。
  const unsubscribeAskResolved = input.hitl?.askUser?.subscribeResolved?.((event) => {
    if (!input.hitl?.accept(event.request)) return;
    for (const toolEvent of translator.completeTool(
      event.request.toolCallId,
      event.resultText,
      false,
    )) {
      markDirty(toolEvent);
      input.write(projector.project(toolEvent));
    }
  });
  let iterator: AsyncIterator<unknown> | undefined;
  const interruptVendor = () => {
    try {
      input.onTimeout?.();
    } catch {
      /* ignore */
    }
  };
  const onAbort = () => {
    aborted = true;
    // 停厂商 + 关迭代；真正跳出 await next() 靠下方与 signal 的竞态
    interruptVendor();
    void iterator?.return?.().catch(() => undefined);
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    iterator = input.source[Symbol.asyncIterator]();
    // 空闲窗口：每次等下一条都给满 timeoutMs（处理耗时不吃窗口），避免长任务被墙钟总时长误杀
    for (;;) {
      if (aborted || input.signal?.aborted) {
        aborted = true;
        interruptVendor();
        void iterator.return?.().catch(() => undefined);
        break;
      }
      // 与 abort 竞态：OpenCode SSE 挂死时不能干等 next()，否则群聊卡「进行中」
      const next = await nextExternalMessage(iterator, input.timeoutMs, input.signal);
      if (next === "aborted") {
        aborted = true;
        interruptVendor();
        void iterator.return?.().catch(() => undefined);
        break;
      }
      if (next === "timeout") {
        timedOut = true;
        interruptVendor();
        void iterator.return?.().catch(() => undefined);
        break;
      }
      if (next.done) break;
      const message = next.value;
      if (aborted || input.signal?.aborted) {
        aborted = true;
        interruptVendor();
        void iterator.return?.().catch(() => undefined);
        break;
      }
      for (const event of translator.push(message)) {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          const { text } = sanitizeStreamText(event.assistantMessageEvent.delta);
          if (text.length > 0) visibleText += text;
        }
        markDirty(event);
        input.write(projector.project(event));
      }
      const done = resultFromSdkMessage(message);
      if (done) {
        result = done;
        break;
      }
    }
  } catch (error) {
    input.signal?.removeEventListener("abort", onAbort);
    unsubscribeAskUser?.();
    unsubscribeAskResolved?.();
    unsubscribeApproval?.();
    unsubscribeDelegationStarted?.();
    const raw = error instanceof Error && error.message ? error.message : "对话失败";
    const notice = assistantFailureNotice(raw, input.locale) ?? raw;
    finishOpenTools(aborted ? "已停止" : notice);
    writeBack(input, translator, visibleText || notice, result, aborted);
    if (input.errorPolicy === "propagate") throw error;
    if (input.errorPolicy === "wake") {
      if (input.outcome) input.outcome.aborted = aborted;
      input.write(projector.finish(raw));
      throw error;
    }
    input.write(projector.finish(notice));
    return { visibleText, result, aborted };
  }
  input.signal?.removeEventListener("abort", onAbort);
  unsubscribeAskUser?.();
  unsubscribeAskResolved?.();
  unsubscribeApproval?.();
  unsubscribeDelegationStarted?.();

  if (result?.permissionDenials) {
    // 被挡下的操作不写失败，但排障要看得见
    console.error(`[runtime] 外部 agent 有 ${result.permissionDenials} 个操作未获授权被跳过`);
  }

  // 中断优先：SDK 就算照常返回结果，也不能当成功
  if (aborted) {
    finishOpenTools("已停止");
    input.write(projector.finish("已停止"));
    writeBack(input, translator, visibleText, null, true);
    if (input.outcome) input.outcome.aborted = true;
    return { visibleText, result: null, aborted: true };
  }
  if (timedOut) {
    const raw = "外部 agent 空闲超时（长时间无新消息）";
    finishOpenTools(raw);
    input.write(projector.finish(assistantFailureNotice(raw, input.locale) ?? raw));
    writeBack(input, translator, visibleText, null, false);
    return { visibleText, result: null, aborted: false };
  }
  if (!result) {
    const raw = "外部 agent 没有返回结果";
    finishOpenTools(raw);
    input.write(projector.finish(assistantFailureNotice(raw, input.locale) ?? raw));
    writeBack(input, translator, visibleText, null, false);
    return { visibleText, result: null, aborted: false };
  }
  // 没有流式事件时只有 result：把最终文本补成正文，否则用户看到空气泡
  if (result && visibleText.length === 0 && result.finalText) {
    visibleText = result.finalText;
    input.write(projector.project(externalTextEvent(result.finalText)));
  }
  if (result && result.finishReason === "error") {
    const raw = result.error?.message ?? "外部 agent 执行失败";
    finishOpenTools(raw);
    input.write(projector.finish(assistantFailureNotice(raw, input.locale) ?? raw));
  } else {
    // 成功收尾：缺 tool_result 时补占位，但不标错误（真实结果已由 completeTool / fromUser 写入）
    finishOpenTools("（无独立工具输出）", false);
    input.write(projector.finish());
  }
  writeBack(input, translator, visibleText || result?.finalText || "", result, false);
  if (input.outcome) input.outcome.aborted = false;
  return { visibleText, result, aborted: false };
}

/**
 * PromptSession 上的 SDK 直连统一入口。主对话、群 holder 与委托都走这里，
 * 避免某条入口退回只消费最终 result 的 streamSimple 通道。
 */
export async function runExternalSessionTurn(input: {
  session: PromptSession;
  text: string;
  userText?: string;
  signal?: AbortSignal;
  write: (chunks: UIMessageChunk[]) => void;
  locale?: UiLocale | string | null;
  errorPolicy: TurnErrorPolicy;
  outcome?: { aborted: boolean };
  onDirty?: () => void;
  hitl?: ExternalTurnInput["hitl"];
  delegationStarted?: ExternalTurnInput["delegationStarted"];
  /**
   * 超预算时 Host 语义压缩。传入则 `maybeCompactBranch`；失败/未超限不阻塞本轮。
   * summarize 须与会话同一 provider（见 createCompactSummarize）。
   */
  compactSummarize?: (plainTranscript: string) => Promise<string>;
  /** 压缩触发字符预算（按会话模型窗）；默认见 shouldCompactFeed */
  compactBudgetChars?: number;
  /** flatten 硬裁上限（按会话模型窗） */
  promptMaxChars?: number;
  /** SDK 不走 Pi extension，收尾自行写入 reply-model custom entry。 */
  model?: ModelConfig;
  /** 解析模型展示名用的本机数据根。 */
  userDataRoot?: string;
}): Promise<ExternalTurnResult | null> {
  if (!input.session.externalQuery) return null;
  const replyModel = input.model
    ? replyModelFromConfig(input.model, input.userDataRoot ?? "")
    : undefined;
  const writeBack = ({
    text,
    toolDigest,
    trail,
    aborted,
  }: {
    text: string;
    toolDigest: string[];
    trail: ExternalTrailItem[];
    aborted: boolean;
  }) => {
    if (aborted) return;
    appendExternalTurnToSession(input.session, {
      ...(input.userText ? { userText: input.userText } : {}),
      text,
      toolDigest,
      trail,
      ...(replyModel ? { replyModel } : {}),
    });
  };

  if (input.compactSummarize && input.session.sessionManager) {
    try {
      await maybeCompactBranch({
        entries: input.session.sessionManager.getBranch?.() ?? [],
        userText: input.text,
        summarize: input.compactSummarize,
        sink: input.session.sessionManager,
        ...(input.compactBudgetChars !== undefined
          ? { budgetChars: input.compactBudgetChars }
          : {}),
      });
    } catch {
      // 压缩失败不挡本轮；拼装侧仍有字符回退
    }
  }

  let query: Awaited<ReturnType<NonNullable<PromptSession["externalQuery"]>>>;
  try {
    // 把停止信号传进起流：Copilot 等冷启期间 Composer 停止才能 abort
    query = await input.session.externalQuery(
      externalPromptFromSession(input.session, input.text, {
        ...(input.promptMaxChars !== undefined ? { maxChars: input.promptMaxChars } : {}),
      }),
      input.signal,
    );
  } catch (error) {
    const failed = (async function* () {
      throw error;
      // 保持 AsyncGenerator 形状；实际永远走不到。
      yield undefined;
    })();
    return runExternalTurn({
      source: failed,
      signal: input.signal,
      write: input.write,
      locale: input.locale,
      errorPolicy: input.errorPolicy,
      outcome: input.outcome,
      onDirty: input.onDirty,
      hitl: input.hitl,
      delegationStarted: input.delegationStarted,
      writeBack,
      ...(replyModel ? { replyModel } : {}),
    });
  }
  const abortExternal = () => {
    query.controller.abort();
    query.abort?.();
  };
  if (input.signal?.aborted) abortExternal();
  else input.signal?.addEventListener("abort", abortExternal, { once: true });
  try {
    return await runExternalTurn({
      source: query.iterable,
      signal: input.signal,
      timeoutMs: query.timeoutMs,
      onTimeout: abortExternal,
      write: input.write,
      locale: input.locale,
      errorPolicy: input.errorPolicy,
      outcome: input.outcome,
      onDirty: input.onDirty,
      hitl: input.hitl,
      delegationStarted: input.delegationStarted,
      writeBack,
      ...(replyModel ? { replyModel } : {}),
      ...(query.todoProjector ? { todoProjector: query.todoProjector } : {}),
    });
  } finally {
    input.signal?.removeEventListener("abort", abortExternal);
    await query.close?.().catch(() => undefined);
  }
}

async function nextExternalMessage(
  iterator: AsyncIterator<unknown>,
  timeoutMs: number | undefined,
  signal?: AbortSignal,
): Promise<IteratorResult<unknown> | "timeout" | "aborted"> {
  if (signal?.aborted) return "aborted";
  if (timeoutMs !== undefined && timeoutMs <= 0) return "timeout";
  if (timeoutMs === undefined && !signal) return iterator.next();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<IteratorResult<unknown> | "timeout" | "aborted">((resolve, reject) => {
      let settled = false;
      const finish = (value: IteratorResult<unknown> | "timeout" | "aborted") => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      onAbort = () => finish("aborted");
      signal?.addEventListener("abort", onAbort, { once: true });
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => finish("timeout"), timeoutMs);
      }
      void iterator.next().then(
        (result) => finish(result),
        (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        },
      );
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

/** 最小面：appendMessage + 可选 custom entry（summary / 隐藏 digest）。 */
export type ExternalTurnSink = {
  sessionManager?: {
    appendMessage?(message: unknown): unknown;
    appendCustomEntry?(customType: string, data?: unknown): unknown;
    appendCustomMessageEntry?(
      customType: string,
      content: string,
      display: boolean,
      details?: unknown,
    ): unknown;
    getBranch?(): unknown[];
  };
};

/**
 * 直连 SDK 绕开 Pi agent loop 后，自己从同一份 session branch 拼 prompt。
 * 隐藏 custom message（专家提示、异步结果、压缩边界等）进可喂视图；规格见 agent-context-compaction.md § SDK。
 */
export function externalPromptFromSession(
  session: ExternalTurnSink | undefined,
  userText: string,
  options?: { maxChars?: number },
): string {
  const entries = session?.sessionManager?.getBranch?.() ?? [];
  return transcriptToPrompt(feedMessagesFromBranch(entries, userText), {
    ...(options?.maxChars !== undefined ? { maxChars: options.maxChars } : {}),
  });
}

/**
 * 把外部回合写回 Pi 会话（§12.6 第 4 条的"隐藏成本"）。
 * 按 trail 写 toolCall / toolResult + 正文，供 `projectHistory` 重载多 tab；
 * 可见总结**不含** toolDigest 长尾；digest 仅作 display:false 隐藏上下文。
 */
export function appendExternalTurnToSession(
  session: ExternalTurnSink | undefined,
  input: {
    userText?: string;
    text: string;
    toolDigest: string[];
    trail?: ExternalTrailItem[];
    replyModel?: AgentUpReplyModel;
  },
): void {
  const manager = session?.sessionManager;
  if (!manager?.appendMessage) return;
  const now = Date.now();
  if (input.userText?.trim()) {
    manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: input.userText }],
      timestamp: now,
    });
  }

  const items = mergeTrailWithFinalText(input.trail ?? [], input.text ?? "");
  let textPartIndex = 0;
  let lastTextOrdinal: number | undefined;
  let wroteAnything = false;

  for (const item of items) {
    if (item.kind === "text") {
      const body = item.text.trim();
      if (!body) continue;
      manager.appendMessage(
        externalAssistantMessage([{ type: "text", text: body }], now, "stop", input.replyModel),
      );
      lastTextOrdinal = textPartIndex;
      textPartIndex += 1;
      wroteAnything = true;
      continue;
    }
    manager.appendMessage(
      externalAssistantMessage(
        [{ type: "toolCall", id: item.id, name: item.name, arguments: item.args }],
        now,
        "toolUse",
        input.replyModel,
      ),
    );
    wroteAnything = true;
    if (item.done || item.result !== undefined) {
      manager.appendMessage({
        role: "toolResult",
        toolCallId: item.id,
        toolName: item.name,
        content: toolResultContent(item.result),
        isError: item.isError === true,
        timestamp: now,
      });
    }
  }

  if (!wroteAnything) return;

  if (typeof manager.appendCustomEntry === "function") {
    if (input.replyModel) {
      try {
        manager.appendCustomEntry(AGENTUP_REPLY_MODEL_CUSTOM_TYPE, input.replyModel);
      } catch {
        // reply-model 写失败不影响正文
      }
    }
    if (lastTextOrdinal !== undefined) {
      try {
        manager.appendCustomEntry(AGENTUP_SUMMARY_CUSTOM_TYPE, { textPartIndex: lastTextOrdinal });
      } catch {
        // summary 写失败不影响正文
      }
    }
  }

  // 隐藏上下文：下一轮 transcriptToPrompt 能看见「用过什么」，但不进用户总结正文
  if (input.toolDigest.length > 0 && typeof manager.appendCustomMessageEntry === "function") {
    try {
      manager.appendCustomMessageEntry(
        "agentup.external_tool_digest",
        `（本轮用过的工具：${input.toolDigest.join("、")}）`,
        false,
      );
    } catch {
      // 忽略
    }
  }
}

/** trail 无正文时用最终可见 text 补一段，保证总结有落点。 */
export function mergeTrailWithFinalText(
  trail: ExternalTrailItem[],
  finalText: string,
): ExternalTrailItem[] {
  const items = trail.map((item) =>
    item.kind === "text" ? { ...item } : { ...item, args: { ...item.args } },
  );
  const trimmed = finalText.trim();
  if (!trimmed) return items;
  const trailText = items
    .filter((item): item is Extract<ExternalTrailItem, { kind: "text" }> => item.kind === "text")
    .map((item) => item.text)
    .join("");
  if (!trailText.trim()) {
    items.push({ kind: "text", text: trimmed });
    return items;
  }
  if (trailText.includes(trimmed) || trimmed === trailText.trim()) return items;
  // 流式旁白已在 trail，最终 result 另有一段总结
  items.push({ kind: "text", text: trimmed });
  return items;
}

function externalAssistantMessage(
  content: unknown[],
  timestamp: number,
  stopReason: "stop" | "toolUse" = "stop",
  replyModel?: AgentUpReplyModel,
): Record<string, unknown> {
  // 与 Pi AssistantMessage 同形：有 replyModel 时写真实 template/model，避免 agentup/external-agent 占位。
  return {
    role: "assistant",
    content,
    api: "agentup-agent-sdk",
    provider: replyModel?.templateId || "agentup",
    model: replyModel?.modelId || "external-agent",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp,
  };
}

function toolResultContent(result: unknown): unknown {
  // ViewImage 等会塞 data:image base64；落盘前剥离，避免下一轮 prompt 爆窗
  const cleaned = sanitizeToolResultForContext(result);
  if (typeof cleaned === "string") return [{ type: "text", text: cleaned }];
  if (Array.isArray(cleaned)) return cleaned;
  if (cleaned == null) return [{ type: "text", text: "" }];
  try {
    return [{ type: "text", text: JSON.stringify(cleaned) }];
  } catch {
    return [{ type: "text", text: String(cleaned) }];
  }
}

function writeBack(
  input: ExternalTurnInput,
  translator: ReturnType<typeof createExternalTranslator>,
  visibleText: string,
  result: WorkerResult | null,
  aborted: boolean,
): void {
  if (!input.writeBack) return;
  try {
    input.writeBack({
      text: visibleText || result?.finalText || "",
      toolDigest: translator.toolDigest,
      trail: translator.trail,
      aborted,
    });
  } catch {
    // 回写失败不能让整轮挂掉：下一轮最多是"重放少一点"
  }
}
