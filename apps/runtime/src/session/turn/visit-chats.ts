import path from "node:path";

import { createUIMessageStream, type UIMessageChunk } from "ai";

import type { ModelConfig } from "../../config/load.js";
import type { UiLocale } from "../../i18n/locale.js";
import type { Visit } from "../../package/sync.js";
import type { PromptAttachment } from "../workspace/attachments.js";
import { materializePromptImages } from "../workspace/attachments.js";
import {
  discoverRecruitedAgents,
  formatDiscoveredAgentsContext,
  RELEVANT_AGENTS_CUSTOM_TYPE,
  type DelegationService,
} from "../delegation/index.js";
import { PiUIMessageProjector } from "../history/frames.js";
import type { ApprovalBroker } from "../hitl/approval/index.js";
import { isVisitOwnHitl, shouldBubbleNestedHitl } from "../hitl/origin.js";
import {
  isModelServiceUnavailable,
  isUserCancelError,
  modelUnavailableNotice,
} from "../model/unavailable.js";
import { expandSkillReferences } from "../skills/expand.js";
import {
  consumeStreamDegeneration,
  sanitizeStreamText,
  streamDegenerationAbortedMessage,
} from "../stream-guard.js";
import type { AskUserBroker } from "../tools/index.js";
import {
  AsyncWakeBroker,
  ASYNC_WAKE_CUSTOM_TYPE,
  formatWakeContent,
  type AsyncWakeItem,
} from "../wake/index.js";
import {
  wakeSourcesFromDetails,
  type BusyTurnInfo,
  type BusyTurnPhase,
  type BusyTurnSource,
} from "./busy-turn.js";
import {
  rewindSession,
  slotModelKey,
  trackModelFailure,
  visitKey,
  visitKind,
} from "./helpers.js";
import { openPromptSession } from "./open.js";
import { TurnStreamHub } from "./turn-stream-hub.js";
import {
  ChatBusy,
  type PromptRewind,
  type PromptSession,
  type VisitChatsWakeDeps,
} from "./types.js";

export type TurnProgressEvent =
  | { type: "dirty"; agentId: string; phase: BusyTurnPhase }
  | { type: "done"; agentId: string };

type Slot = {
  digest: string;
  /** templateId::modelId；换模型时重建 Slot。 */
  modelKey: string;
  session: PromptSession;
  busy: boolean;
  stale: boolean;
  /** prompt=用户回合；wake=异步结果主动同步。 */
  turnPhase?: BusyTurnPhase;
  /** wake 回合的来源专家 / 后台作业（编排条）。 */
  wakeSources?: BusyTurnSource[];
  /** 当前 turn 的 finally 完成后 resolve；供 abort 等待 busy 真正解开。 */
  turnDone?: Promise<void>;
  resolveTurn?: () => void;
};

export class VisitChats {
  private readonly sessions = new Map<string, Slot>();
  private readonly wake: AsyncWakeBroker;
  /** 编排条：turn 阶段订阅（按 userId）。 */
  private readonly turnProgress = new Map<string, Set<(event: TurnProgressEvent) => void>>();
  /** wake 等无 prompt 客户端的回合：UIMessage 旁路流。 */
  private readonly turnStreams = new TurnStreamHub();

  constructor(
    private readonly open: (visit: Visit, model: ModelConfig) => Promise<PromptSession> = openPromptSession,
    private readonly approvals?: ApprovalBroker,
    private readonly askUser?: AskUserBroker,
    private readonly delegation?: DelegationService,
    private readonly wakeDeps?: VisitChatsWakeDeps,
  ) {
    this.wake = new AsyncWakeBroker(
      (input) => this.runWakeTurn(input),
      (userId, agentId, kind) => this.busy(userId, agentId, kind),
    );
  }

  /**
   * 异步完成入队：父会话空闲则主动 wake 出一条助手回复；
   * 若用户先发言则并进该轮（nextTurn），不另开 turn。
   */
  enqueueAsyncWake(item: AsyncWakeItem): void {
    this.wake.enqueue(item);
  }

  busy(userId: string, agentId: string, kind: Visit["kind"] = "recruited"): boolean {
    return this.sessions.get(visitKey(userId, agentId, kind))?.busy === true;
  }

  /** 当前用户下主会话正在跑 turn 的 agentId（侧栏 working）。 */
  busyAgentIds(userId: string): string[] {
    return this.busyTurns(userId).map((item) => item.agentId);
  }

  /** 带阶段的 busy 快照（attention / 编排条）。 */
  busyTurns(userId: string): BusyTurnInfo[] {
    const turns: BusyTurnInfo[] = [];
    for (const [key, slot] of this.sessions) {
      if (!slot.busy) continue;
      const [uid, , agentId] = key.split("/");
      if (uid !== userId || !agentId) continue;
      turns.push({
        agentId,
        phase: slot.turnPhase ?? "prompt",
        sources: slot.wakeSources ? [...slot.wakeSources] : [],
      });
    }
    return turns;
  }

  /** 订阅某用户的 turn 进度（SSE dirty/done）。 */
  subscribeTurnProgress(
    userId: string,
    listener: (event: TurnProgressEvent) => void,
  ): () => void {
    const set = this.turnProgress.get(userId) ?? new Set();
    set.add(listener);
    this.turnProgress.set(userId, set);
    return () => {
      const current = this.turnProgress.get(userId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.turnProgress.delete(userId);
    };
  }

  private emitTurnProgress(userId: string, event: TurnProgressEvent): void {
    const set = this.turnProgress.get(userId);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // 订阅方异常不阻断 turn
      }
    }
  }

  /** wake UIMessage 旁路：是否仍有可订阅流（含已关闭但有缓冲）。 */
  hasTurnStream(userId: string, agentId: string): boolean {
    const key = TurnStreamHub.key(userId, agentId);
    return this.turnStreams.isOpen(key) || this.turnStreams.hasBuffer(key);
  }

  isTurnStreamOpen(userId: string, agentId: string): boolean {
    return this.turnStreams.isOpen(TurnStreamHub.key(userId, agentId));
  }

  /**
   * 订阅 wake 等旁路 UIMessage chunk。
   * 晚订阅先回放；已关闭则只回放并 closed=true。
   */
  subscribeTurnStream(
    userId: string,
    agentId: string,
    listener: (chunk: UIMessageChunk) => void,
  ): { unsubscribe: () => void; closed: boolean } {
    return this.turnStreams.subscribe(TurnStreamHub.key(userId, agentId), listener);
  }

  /**
   * 用户停止 / 清上下文：中断 Pi 当前 turn，并等到 busy 解开。
   * 空闲时为 no-op。
   */
  async abort(userId: string, agentId: string, kind: Visit["kind"] = "recruited"): Promise<void> {
    const key = visitKey(userId, agentId, kind);
    const current = this.sessions.get(key);
    if (!current?.busy) return;
    await current.session.abort();
    if (current.turnDone) await current.turnDone;
  }

  release(userId: string, agentId: string, kind: Visit["kind"] = "recruited"): void {
    const key = visitKey(userId, agentId, kind);
    const current = this.sessions.get(key);
    if (!current) return;
    if (current.busy) throw new ChatBusy();
    this.disposeKey(key);
  }

  /** 私人助理资料 / skills / MCP / AGENTS.md 变更后只作废私人助理会话。 */
  invalidatePersonalAssistant(userId: string): void {
    this.invalidate(userId, "personal-assistant", "personal");
  }

  /** 作废指定 Visit 的内存会话（忙则标 stale）。 */
  invalidate(userId: string, agentId: string, kind: Visit["kind"] = "recruited"): void {
    const target = visitKey(userId, agentId, kind);
    const current = this.sessions.get(target);
    if (!current) return;
    if (current.busy) {
      current.stale = true;
      return;
    }
    this.disposeKey(target);
  }

  async promptStream(
    visit: Visit,
    model: ModelConfig,
    text: string,
    signal?: AbortSignal,
    rewind?: PromptRewind,
    attachments: readonly PromptAttachment[] = [],
    locale?: UiLocale | string | null,
  ) {
    const key = visitKey(visit.userId, visit.agentId, visit.kind);
    const nextModelKey = slotModelKey(model);
    let current = this.sessions.get(key);
    if (
      current &&
      (current.digest !== visit.packageDigest || current.stale || current.modelKey !== nextModelKey)
    ) {
      if (current.busy) throw new ChatBusy();
      this.disposeKey(key);
      current = undefined;
    }
    if (current?.busy) throw new ChatBusy();
    if (!current) {
      current = {
        digest: visit.packageDigest,
        modelKey: nextModelKey,
        session: await this.open(visit, model),
        busy: false,
        stale: false,
      };
      this.sessions.set(key, current);
    }
    const slot = current;
    slot.busy = true;
    slot.turnPhase = "prompt";
    slot.wakeSources = undefined;
    slot.turnDone = new Promise<void>((resolve) => {
      slot.resolveTurn = resolve;
    });
    this.emitTurnProgress(visit.userId, {
      type: "dirty",
      agentId: visit.agentId,
      phase: "prompt",
    });
    return createUIMessageStream({
      execute: async ({ writer }) => {
        const projector = new PiUIMessageProjector();
        const write = (chunks: UIMessageChunk[]) => {
          for (const chunk of chunks) writer.write(chunk);
        };
        let lastModelError = "";
        let sawAssistantText = false;
        let lastDirtyAt = 0;
        const unsubscribe = slot.session.subscribe((event) => {
          trackModelFailure(event, (error) => {
            lastModelError = error;
          });
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "text_delta" &&
            typeof event.assistantMessageEvent.delta === "string" &&
            event.assistantMessageEvent.delta.length > 0
          ) {
            // 仅统计剥离 special 后的可见正文，避免刷 placeholder 被当成「已有输出」。
            const { text } = sanitizeStreamText(event.assistantMessageEvent.delta);
            if (text.length > 0) sawAssistantText = true;
          }
          // 节流 dirty：编排条 / 旁路刷新不必每个 delta 都打。
          const now = Date.now();
          if (
            event.type === "entry_appended" ||
            event.type === "tool_execution_start" ||
            event.type === "tool_execution_end" ||
            now - lastDirtyAt > 800
          ) {
            lastDirtyAt = now;
            this.emitTurnProgress(visit.userId, {
              type: "dirty",
              agentId: visit.agentId,
              phase: "prompt",
            });
          }
          write(projector.project(event));
        });
        const acceptsHitl = (request: {
          userId: string;
          agentId: string;
          origin?: "visit" | "delegation";
          parentAgentId?: string;
        }): boolean => {
          if (request.userId !== visit.userId) return false;
          if (isVisitOwnHitl(request, visit.agentId)) return true;
          if (!this.delegation) return false;
          return shouldBubbleNestedHitl(request, visit, (userId, parent, child) =>
            this.delegation!.isNestedUnder(userId, parent, child),
          );
        };
        const unsubscribeApproval = this.approvals?.subscribe((request) => {
          if (!acceptsHitl(request)) return;
          write(
            projector.approval({
              id: request.id,
              toolCallId: request.toolCallId,
              toolName: request.toolName,
              args: request.args,
            }),
          );
        });
        const unsubscribeAskUser = this.askUser?.subscribe((request) => {
          if (!acceptsHitl(request)) return;
          write(
            projector.askUser({
              id: request.id,
              toolCallId: request.toolCallId,
              questions: request.questions,
            }),
          );
        });
        // 委托 started：只写 transient 元数据，过程走 /delegations/:id/stream 旁路。
        const unsubscribeDelegationStarted = this.delegation?.subscribeStarted((event) => {
          if (event.userId !== visit.userId || event.fromAgentId !== visit.agentId) return;
          write(
            projector.delegationStarted({
              taskId: event.taskId,
              toolCallId: event.toolCallId,
              toAgentId: event.toAgentId,
              toAgentName: event.toAgentName,
              brief: event.brief,
              wait: event.wait,
            }),
          );
        });
        const onAbort = () => {
          void slot.session.abort().catch(() => undefined);
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
        try {
          await rewindSession(slot.session, rewind);
          const cwd = path.join(visit.root, "cwd");
          // 非图片已在 Composer 插入时落盘，正文含 @ATTACHMENTS/...；此处只处理图片 vision。
          const images = materializePromptImages(cwd, attachments);
          const promptText = text.trim();
          if (!promptText && images.length === 0) throw new Error("消息为空");
          // 任意位置的 `/name`|/skill:name` 由 harness 展开，避免依赖 Pi 仅识别行首 `/skill:`。
          const skills = slot.session.resourceLoader?.getSkills().skills ?? [];
          const expanded = expandSkillReferences(promptText || "(图片附件)", skills);
          // 若异步结果已在排队且用户先发言：并进本轮，避免 turn 结束后再抢一次 wake。
          await this.injectPendingAsyncWake(slot.session, visit);
          // 每轮按用户话术检索已招募专家；有命中才经 nextTurn 注入（不污染用户落盘原文）。
          if (this.delegation && slot.session.sendCustomMessage && promptText) {
            try {
              const roster = await this.delegation.listRecruited(visit.userId);
              const others = roster.filter((agent) => agent.agentId !== visit.agentId);
              const discovered = discoverRecruitedAgents(others, promptText);
              const block = formatDiscoveredAgentsContext(discovered);
              if (block) {
                await slot.session.sendCustomMessage(
                  {
                    customType: RELEVANT_AGENTS_CUSTOM_TYPE,
                    content: block,
                    display: false,
                  },
                  { deliverAs: "nextTurn" },
                );
              }
            } catch {
              // 发现失败不阻断对话；模型仍可主动 agent_search。
            }
          }
          await slot.session.prompt(expanded, {
            expandPromptTemplates: false,
            ...(images.length > 0 ? { images } : {}),
          });
          if (
            !sawAssistantText &&
            lastModelError &&
            isModelServiceUnavailable(lastModelError)
          ) {
            const notice = modelUnavailableNotice(locale);
            write(projector.modelUnavailable(notice));
            write(projector.finish());
          } else if (
            !sawAssistantText &&
            slot.session.sessionManager &&
            consumeStreamDegeneration(slot.session.sessionManager)
          ) {
            write(projector.finish(streamDegenerationAbortedMessage(locale)));
          } else {
            write(projector.finish());
          }
        } catch (error) {
          const raw = error instanceof Error && error.message ? error.message : "对话失败";
          if (isModelServiceUnavailable(raw) && !isUserCancelError(raw)) {
            const notice = modelUnavailableNotice(locale);
            if (!sawAssistantText) write(projector.modelUnavailable(notice));
            write(projector.finish(notice));
          } else {
            write(projector.finish(raw));
          }
        } finally {
          // busy 跟 Pi prompt 对齐，不跟 HTTP 消费者断开（onEnd/cancel）对齐；
          // 停止时由 signal / VisitChats.abort 调用 session.abort()，再在这里清 busy。
          signal?.removeEventListener("abort", onAbort);
          unsubscribeDelegationStarted?.();
          unsubscribeAskUser?.();
          unsubscribeApproval?.();
          unsubscribe();
          slot.busy = false;
          slot.turnPhase = undefined;
          slot.wakeSources = undefined;
          slot.resolveTurn?.();
          slot.resolveTurn = undefined;
          slot.turnDone = undefined;
          this.emitTurnProgress(visit.userId, { type: "done", agentId: visit.agentId });
          if (slot.stale) this.disposeKey(key);
          this.wake.onParentIdle(visit.userId, visit.agentId, visitKind(visit));
        }
      },
    });
  }

  /** 用户发言前：把排队结果并进本轮（display:false + nextTurn）。 */
  private async injectPendingAsyncWake(session: PromptSession, visit: Visit): Promise<void> {
    if (!session.sendCustomMessage) return;
    const kind = visitKind(visit);
    const batch = this.wake.takePending(visit.userId, visit.agentId, kind);
    if (batch.length === 0) return;
    try {
      await session.sendCustomMessage(
        {
          customType: ASYNC_WAKE_CUSTOM_TYPE,
          content: formatWakeContent(batch),
          display: false,
          details: { items: batch.map((item) => item.details ?? { id: item.id }) },
        },
        { deliverAs: "nextTurn" },
      );
      for (const item of batch) {
        try {
          item.markDelivered();
        } catch {
          // 标记失败不阻断对话
        }
      }
    } catch {
      this.wake.requeue(batch);
    }
  }

  /**
   * 空闲主动同步：display:false + triggerTurn → 新助手气泡。
   * 历史投影对 async_wake 分段，不会与上一句 assistant 合并。
   */
  private async runWakeTurn(input: {
    userId: string;
    agentId: string;
    kind: AsyncWakeItem["kind"];
    content: string;
    details: { items: unknown[] };
  }): Promise<void> {
    if (!this.wakeDeps) throw new Error("异步唤醒未配置");
    if (this.busy(input.userId, input.agentId, input.kind)) throw new ChatBusy();
    const visit = await this.wakeDeps.resolveVisit(input.userId, input.agentId, input.kind);
    if (!visit) throw new Error("无法打开会话以投递异步结果");
    const model = this.wakeDeps.resolveModel(visit);
    const key = visitKey(visit.userId, visit.agentId, visit.kind);
    const nextModelKey = slotModelKey(model);
    let current = this.sessions.get(key);
    if (
      current &&
      (current.digest !== visit.packageDigest || current.stale || current.modelKey !== nextModelKey)
    ) {
      if (current.busy) throw new ChatBusy();
      this.disposeKey(key);
      current = undefined;
    }
    if (current?.busy) throw new ChatBusy();
    if (!current) {
      current = {
        digest: visit.packageDigest,
        modelKey: nextModelKey,
        session: await this.open(visit, model),
        busy: false,
        stale: false,
      };
      this.sessions.set(key, current);
    }
    const slot = current;
    if (!slot.session.sendCustomMessage) {
      throw new Error("会话不支持异步唤醒");
    }
    slot.busy = true;
    slot.turnPhase = "wake";
    slot.wakeSources = wakeSourcesFromDetails(input.details);
    slot.turnDone = new Promise<void>((resolve) => {
      slot.resolveTurn = resolve;
    });
    const streamKey = TurnStreamHub.key(input.userId, input.agentId);
    // 先开槽再 dirty：桌面连 /turn-stream 时已有可订阅流。
    this.turnStreams.begin(streamKey);
    this.emitTurnProgress(input.userId, {
      type: "dirty",
      agentId: input.agentId,
      phase: "wake",
    });
    const projector = new PiUIMessageProjector();
    const write = (chunks: UIMessageChunk[]) => {
      this.turnStreams.write(streamKey, chunks);
    };
    let lastDirtyAt = 0;
    let lastModelError = "";
    let sawAssistantText = false;
    const unsubscribe = slot.session.subscribe((event) => {
      trackModelFailure(event, (error) => {
        lastModelError = error;
      });
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta" &&
        typeof event.assistantMessageEvent.delta === "string" &&
        event.assistantMessageEvent.delta.length > 0
      ) {
        const { text } = sanitizeStreamText(event.assistantMessageEvent.delta);
        if (text.length > 0) sawAssistantText = true;
      }
      const now = Date.now();
      if (
        event.type === "entry_appended" ||
        event.type === "tool_execution_start" ||
        event.type === "tool_execution_end" ||
        event.type === "message_start" ||
        now - lastDirtyAt > 800
      ) {
        lastDirtyAt = now;
        this.emitTurnProgress(input.userId, {
          type: "dirty",
          agentId: input.agentId,
          phase: "wake",
        });
      }
      write(projector.project(event));
    });
    const acceptsHitl = (request: {
      userId: string;
      agentId: string;
      origin?: "visit" | "delegation";
      parentAgentId?: string;
    }): boolean => {
      if (request.userId !== input.userId) return false;
      if (isVisitOwnHitl(request, input.agentId)) return true;
      if (!this.delegation) return false;
      return shouldBubbleNestedHitl(
        request,
        { userId: input.userId, agentId: input.agentId },
        (userId, parent, child) => this.delegation!.isNestedUnder(userId, parent, child),
      );
    };
    const unsubscribeApproval = this.approvals?.subscribe((request) => {
      if (!acceptsHitl(request)) return;
      write(
        projector.approval({
          id: request.id,
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          args: request.args,
        }),
      );
    });
    const unsubscribeAskUser = this.askUser?.subscribe((request) => {
      if (!acceptsHitl(request)) return;
      write(
        projector.askUser({
          id: request.id,
          toolCallId: request.toolCallId,
          questions: request.questions,
        }),
      );
    });
    const unsubscribeDelegationStarted = this.delegation?.subscribeStarted((event) => {
      if (event.userId !== input.userId || event.fromAgentId !== input.agentId) return;
      write(
        projector.delegationStarted({
          taskId: event.taskId,
          toolCallId: event.toolCallId,
          toAgentId: event.toAgentId,
          toAgentName: event.toAgentName,
          brief: event.brief,
          wait: event.wait,
        }),
      );
    });
    /** 用户 abort / 409 重试打断时勿 onParentIdle，否则 broker 会马上再开 wake 抢 busy。 */
    let aborted = false;
    try {
      await slot.session.sendCustomMessage(
        {
          customType: ASYNC_WAKE_CUSTOM_TYPE,
          content: input.content,
          display: false,
          details: input.details,
        },
        { triggerTurn: true },
      );
      if (
        !sawAssistantText &&
        lastModelError &&
        isModelServiceUnavailable(lastModelError)
      ) {
        const notice = modelUnavailableNotice(undefined);
        write(projector.modelUnavailable(notice));
        write(projector.finish());
      } else if (
        !sawAssistantText &&
        slot.session.sessionManager &&
        consumeStreamDegeneration(slot.session.sessionManager)
      ) {
        write(projector.finish(streamDegenerationAbortedMessage(undefined)));
      } else {
        write(projector.finish());
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      aborted =
        isUserCancelError(message) ||
        (error instanceof Error && /abort/i.test(error.name));
      if (!aborted) {
        if (isModelServiceUnavailable(message) && !isUserCancelError(message)) {
          const notice = modelUnavailableNotice(undefined);
          if (!sawAssistantText) write(projector.modelUnavailable(notice));
          write(projector.finish(notice));
        } else {
          write(projector.finish(message || "对话失败"));
        }
      } else {
        write(projector.finish(message || "已停止"));
      }
      throw error;
    } finally {
      unsubscribeDelegationStarted?.();
      unsubscribeAskUser?.();
      unsubscribeApproval?.();
      unsubscribe();
      this.turnStreams.finish(streamKey);
      slot.busy = false;
      slot.turnPhase = undefined;
      slot.wakeSources = undefined;
      slot.resolveTurn?.();
      slot.resolveTurn = undefined;
      slot.turnDone = undefined;
      this.emitTurnProgress(input.userId, { type: "done", agentId: input.agentId });
      if (slot.stale) this.disposeKey(key);
      if (!aborted) {
        this.wake.onParentIdle(input.userId, input.agentId, input.kind);
      }
    }
  }

  private disposeKey(key: string): void {
    const current = this.sessions.get(key);
    if (!current) return;
    current.session.dispose();
    this.sessions.delete(key);
    // session 级审批授权留在 state.json：同一次对话跨重启 / 会话重建仍有效；
    // 仅「新对话 / 清上下文 / 清历史」等路由显式 clearSessionAllow。
  }
}
