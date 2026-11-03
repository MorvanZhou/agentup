import path from "node:path";

import { createUIMessageStream, type UIMessageChunk } from "ai";

import type { ModelConfig } from "../../config/load.js";
import { getProviderTemplate } from "../../config/provider-templates.js";
import type { UiLocale } from "../../i18n/locale.js";
import { PERSONAL_ASSISTANT_ID } from "../../local/assistant/personal-assistant.js";
import type { Visit } from "../../package/sync.js";
import type { PromptAttachment } from "../workspace/attachments.js";
import {
  ATTACHMENT_PATHS_CUSTOM_TYPE,
  attachmentRefsInText,
  formatAttachmentLocations,
  materializePromptImages,
} from "../workspace/attachments.js";
import {
  ACTIVE_DELEGATIONS_CUSTOM_TYPE,
  discoverRecruitedAgents,
  formatActiveDelegationsContext,
  formatAgentSearchRequired,
  formatDiscoveredAgentsContext,
  RELEVANT_AGENTS_CUSTOM_TYPE,
  type DelegationService,
  type DelegationStartedEvent,
} from "../delegation/index.js";
import type { ApprovalBroker } from "../hitl/approval/index.js";
import type { ShellHangBroker } from "../hitl/shell-hang/index.js";
import { isVisitOwnHitl, shouldBubbleNestedHitl } from "../hitl/origin.js";
import { delegationHitlAttribution } from "../hitl/surface.js";
import { expandSkillReferences } from "../skills/expand.js";
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
import { customMessageDelivery } from "./custom-message-delivery.js";
import { rewindSession, slotModelKey, visitKey, visitKind } from "./helpers.js";
import { FollowUpQueue, type FollowUpItem } from "./follow-up-queue.js";
import { runExternalSessionTurn as runExternalPromptTurn } from "./external-turn.js";
import { runObservedTurn } from "./turn-runner.js";
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
  visit: Visit;
  model: ModelConfig;
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
  /** followUp 队列：SDK 接入（无原生 steer）时，回合中用户新发消息的落点（§12.8）。 */
  followUps: FollowUpQueue;
  /** 用户停止是会话级信号，不能只依赖当前 HTTP 请求的 signal。 */
  stopRequested: boolean;
  turnAbort?: AbortController;
};

/** 队列定位只需要这三个键，路由层不必先解析出完整 Visit。 */
export type FollowUpRef = {
  userId: string;
  agentId: string;
  kind?: Visit["kind"];
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
    private readonly shellHang?: ShellHangBroker,
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

  /**
   * 本地 Agent App（SDK）接入没有原生 steer，只能用 followUp 队列；
   * API Key / Pi 原生走 Pi 自己的 steer，不排队（.cursor/skills/agentup-sdk-adapter/references/follow-up.md）。
   */
  usesFollowUpQueue(model: ModelConfig): boolean {
    return getProviderTemplate(model.templateId)?.kind === "agent-sdk";
  }

  /**
   * API / Pi 原生接入：把用户新说的话插进正在跑的回合（Pi 原生 `steer`，§12.8）。
   * 与「abort + 重发」不同：已做的工作保留，不另起一条助手消息。
   * 会话没在跑 / 外部 agent 接入（没有原生 steer）/ 空文本 → `steered: false`，
   * 调用方按老路子（停止后重发）处理。
   */
  async steer(visit: Visit, model: ModelConfig, text: string): Promise<{ steered: boolean }> {
    const body = text.trim();
    const slot = this.sessions.get(visitKey(visit.userId, visit.agentId, visit.kind));
    if (!slot || !slot.busy || !body || !slot.session.steer) return { steered: false };
    // 本地 Agent App 没有原生 steer：那边是 followUp 队列（§12.8），别在这里插
    if (this.usesFollowUpQueue(model)) return { steered: false };
    const skills = slot.session.resourceLoader?.getSkills().skills ?? [];
    await slot.session.steer(expandSkillReferences(body, skills));
    return { steered: true };
  }

  private slotOf(ref: FollowUpRef): Slot | undefined {
    return this.sessions.get(visitKey(ref.userId, ref.agentId, ref.kind ?? "recruited"));
  }

  /** 入队。会话没在跑就抛错——调用方应该走正常 prompt，别把话悄悄吞掉。 */
  enqueueFollowUp(ref: FollowUpRef, text: string): FollowUpItem {
    const slot = this.slotOf(ref);
    if (!slot || !slot.busy) throw new Error("会话不在回复中，无需排队");
    return slot.followUps.enqueue(text);
  }

  listFollowUps(ref: FollowUpRef): FollowUpItem[] {
    return this.slotOf(ref)?.followUps.list() ?? [];
  }

  updateFollowUp(ref: FollowUpRef, id: string, text: string): FollowUpItem | null {
    return this.slotOf(ref)?.followUps.update(id, text) ?? null;
  }

  removeFollowUp(ref: FollowUpRef, id: string): boolean {
    return this.slotOf(ref)?.followUps.remove(id) ?? false;
  }

  promoteFollowUp(ref: FollowUpRef, id: string): boolean {
    return this.slotOf(ref)?.followUps.promote(id) ?? false;
  }

  clearFollowUps(ref: FollowUpRef): number {
    return this.slotOf(ref)?.followUps.clear() ?? 0;
  }

  /** 停止后由用户确认继续：显式恢复消费，避免与 abort 收尾竞态。 */
  resumeFollowUps(ref: FollowUpRef): boolean {
    const slot = this.slotOf(ref);
    if (!slot || slot.busy || slot.followUps.size === 0) return false;
    void this.drainFollowUps(slot.visit, slot.model).catch(() => undefined);
    return true;
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
    current.stopRequested = true;
    current.turnAbort?.abort();
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
        visit,
        model,
        session: await this.open(visit, model),
        busy: false,
        stale: false,
        followUps: new FollowUpQueue(),
        stopRequested: false,
      };
      this.sessions.set(key, current);
    } else {
      current.visit = visit;
      current.model = model;
    }
    const slot = current;
    slot.stopRequested = false;
    slot.turnAbort = new AbortController();
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
        const write = (chunks: UIMessageChunk[]) => {
          for (const chunk of chunks) writer.write(chunk);
        };
        const acceptsHitl = (request: {
          userId: string;
          agentId: string;
          origin?: "visit" | "delegation";
          parentAgentId?: string;
          groupId?: string;
        }): boolean => {
          if (request.userId !== visit.userId) return false;
          if (isVisitOwnHitl(request, visit.agentId)) return true;
          if (!this.delegation) return false;
          return shouldBubbleNestedHitl(request, visit, (userId, parent, child) =>
            this.delegation!.isNestedUnder(userId, parent, child),
          );
        };
        const delegationLabel = (request: { origin?: string; taskId?: string }) => {
          if (request.origin !== "delegation" || !request.taskId || !this.delegation) return {};
          return delegationHitlAttribution(this.delegation.getTask(request.taskId));
        };
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
          // 正文里的 @ATTACHMENTS/... 芯片 → 绝对路径注记（display:false，不改用户原文）。
          await this.injectAttachmentPaths(slot.session, cwd, promptText);
          // 若异步结果已在排队且用户先发言：并进本轮，避免 turn 结束后再抢一次 wake。
          await this.injectPendingAsyncWake(slot.session, visit);
          // 进行中委托摘要 → custom message（Pi=nextTurn；SDK=立即 append）。
          await this.injectActiveDelegations(slot.session, visit);
          // 每轮按用户话术检索已招募专家；有命中才注入（不污染用户落盘原文）。
          if (this.delegation && slot.session.sendCustomMessage && promptText) {
            try {
              const roster = await this.delegation.listRecruited(visit.userId);
              const others = roster.filter((agent) => agent.agentId !== visit.agentId);
              const discovered = discoverRecruitedAgents(others, promptText);
              // SDK 面写 MCP 工具名，避免模型去调不存在的裸 agent_search。
              const toolSurface = slot.session.externalQuery ? "external" : "pi";
              const block =
                formatDiscoveredAgentsContext(discovered, { toolSurface }) ||
                (visit.agentId === PERSONAL_ASSISTANT_ID && others.length > 0
                  ? formatAgentSearchRequired({ toolSurface })
                  : "");
              if (block) {
                await slot.session.sendCustomMessage(
                  {
                    customType: RELEVANT_AGENTS_CUSTOM_TYPE,
                    content: block,
                    display: false,
                  },
                  customMessageDelivery(slot.session),
                );
              }
            } catch {
              // 发现失败不阻断对话；模型仍可主动搜花名册。
            }
          }
          this.delegation?.armDelegationDisposition(visit.userId, visit.agentId);
          const onDirty = () => {
            this.emitTurnProgress(visit.userId, {
              type: "dirty",
              agentId: visit.agentId,
              phase: "prompt",
            });
          };
          const delegationStarted = this.delegationStartedFor(
            visit.userId,
            visit.agentId,
          );
          const external = await this.runExternalSessionTurn({
            slot,
            text: expanded,
            userText: promptText || "(图片附件)",
            signal,
            write,
            locale,
            errorPolicy: "prompt",
            onDirty,
            accept: acceptsHitl,
            label: delegationLabel,
            ...(delegationStarted ? { delegationStarted } : {}),
          });
          if (!external) {
            await runObservedTurn({
              session: slot.session,
              signal,
              write,
              locale,
              errorPolicy: "prompt",
              dirty: "prompt",
              onDirty,
              hitl: {
                accept: acceptsHitl,
                label: delegationLabel,
                approvals: this.approvals,
                askUser: this.askUser,
                shellHang: this.shellHang,
              },
              ...(delegationStarted ? { delegationStarted } : {}),
              run: () =>
                slot.session.prompt(expanded, {
                  expandPromptTemplates: false,
                  ...(images.length > 0 ? { images } : {}),
                }),
            });
          }
        } finally {
          this.delegation?.clearDelegationDisposition(visit.userId, visit.agentId);
          // 用户排队的话优先于异步结果：先记下来，等 busy 解开后拼成一条再开一轮（§12.8.1）
          const pendingFollowUps = slot.followUps.size;
          // busy 跟 Pi prompt 对齐，不跟 HTTP 消费者断开（onEnd/cancel）对齐；
          // 停止时由 signal / VisitChats.abort 调用 session.abort()，再在这里清 busy。
          slot.busy = false;
          slot.turnPhase = undefined;
          slot.wakeSources = undefined;
          slot.resolveTurn?.();
          slot.resolveTurn = undefined;
          slot.turnDone = undefined;
          this.emitTurnProgress(visit.userId, { type: "done", agentId: visit.agentId });
          if (slot.stale) this.disposeKey(key);
          slot.turnAbort = undefined;
          if (pendingFollowUps > 0 && !signal?.aborted && !slot.stopRequested) {
            void this.drainFollowUps(visit, model).catch(() => undefined);
          } else {
            // abort 时保留队列；桌面确认继续后显式 resume，避免收尾先把队列抢跑。
            this.wake.onParentIdle(visit.userId, visit.agentId, visitKind(visit));
          }
        }
      },
    });
  }

  /**
   * 正文里的 `@ATTACHMENTS/...` 芯片只给 cwd 相对 token；把仍存在于磁盘的引用
   * 映射成绝对路径注入（display:false）。只注路径，不展开目录内容。
   * Pi=nextTurn；SDK=立即 append。失败不阻断对话。
   */
  private async injectAttachmentPaths(
    session: PromptSession,
    cwd: string,
    text: string,
  ): Promise<void> {
    if (!session.sendCustomMessage || !text) return;
    try {
      const content = formatAttachmentLocations(cwd, attachmentRefsInText(text));
      if (!content) return;
      await session.sendCustomMessage(
        {
          customType: ATTACHMENT_PATHS_CUSTOM_TYPE,
          content,
          display: false,
        },
        customMessageDelivery(session),
      );
    } catch {
      // 注入失败不阻断对话
    }
  }

  /**
   * 本会话仍在进行中的委托 → custom message（display:false）。
   * 无任务则跳过；失败不阻断对话。
   */
  private async injectActiveDelegations(session: PromptSession, visit: Visit): Promise<void> {
    if (!this.delegation || !session.sendCustomMessage) return;
    try {
      const tasks = this.delegation.listTasks(visit.userId, {
        fromAgentId: visit.agentId,
      });
      const block = formatActiveDelegationsContext(tasks);
      if (!block) return;
      await session.sendCustomMessage(
        {
          customType: ACTIVE_DELEGATIONS_CUSTOM_TYPE,
          content: block,
          display: false,
        },
        customMessageDelivery(session),
      );
    } catch {
      // 列表失败不阻断；模型仍可主动 check_delegation。
    }
  }

  /** 用户发言前：把排队结果并进本轮（display:false；Pi=nextTurn；SDK=立即 append）。 */
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
        customMessageDelivery(session),
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
        visit,
        model,
        session: await this.open(visit, model),
        busy: false,
        stale: false,
        followUps: new FollowUpQueue(),
        stopRequested: false,
      };
      this.sessions.set(key, current);
    } else {
      current.visit = visit;
      current.model = model;
    }
    const slot = current;
    if (!slot.session.sendCustomMessage) {
      throw new Error("会话不支持异步唤醒");
    }
    slot.stopRequested = false;
    slot.turnAbort = new AbortController();
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
    const write = (chunks: UIMessageChunk[]) => {
      this.turnStreams.write(streamKey, chunks);
    };
    const acceptsHitl = (request: {
      userId: string;
      agentId: string;
      origin?: "visit" | "delegation";
      parentAgentId?: string;
      groupId?: string;
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
    const delegationLabel = (request: { origin?: string; taskId?: string }) => {
      if (request.origin !== "delegation" || !request.taskId || !this.delegation) return {};
      return delegationHitlAttribution(this.delegation.getTask(request.taskId));
    };
    /** 用户 abort / 409 重试打断时勿 onParentIdle，否则 broker 会马上再开 wake 抢 busy。 */
    const outcome = { aborted: false };
    try {
      const onDirty = () => {
        this.emitTurnProgress(input.userId, {
          type: "dirty",
          agentId: input.agentId,
          phase: "wake",
        });
      };
      this.delegation?.clearDelegationDisposition(input.userId, input.agentId);
      // wake 回合也可能再委托；先注入进行中摘要。
      await this.injectActiveDelegations(slot.session, visit);
      const attemptedExternal = Boolean(slot.session.externalQuery);
      let external = false;
      if (attemptedExternal) {
        // SDK 不走 prompt()，必须立即 append，否则 wake 正文进不了 external prompt。
        await slot.session.sendCustomMessage(
          {
            customType: ASYNC_WAKE_CUSTOM_TYPE,
            content: input.content,
            display: false,
            details: input.details,
          },
          customMessageDelivery(slot.session),
        );
        const wakeDelegationStarted = this.delegationStartedFor(
          input.userId,
          input.agentId,
        );
        external = await this.runExternalSessionTurn({
          slot,
          text: "请根据最新异步结果继续当前任务。",
          write,
          errorPolicy: "wake",
          outcome,
          onDirty,
          accept: acceptsHitl,
          label: delegationLabel,
          ...(wakeDelegationStarted ? { delegationStarted: wakeDelegationStarted } : {}),
        });
      }
      if (!external) {
        const piWakeDelegation = this.delegationStartedFor(input.userId, input.agentId);
        await runObservedTurn({
          session: slot.session,
          write,
          errorPolicy: "wake",
          outcome,
          dirty: "wake",
          onDirty,
          hitl: {
            accept: acceptsHitl,
            label: delegationLabel,
            approvals: this.approvals,
            askUser: this.askUser,
            shellHang: this.shellHang,
          },
          ...(piWakeDelegation ? { delegationStarted: piWakeDelegation } : {}),
          run: () =>
            attemptedExternal
              ? slot.session.prompt("请根据最新异步结果继续当前任务。", {
                  expandPromptTemplates: false,
                })
              : slot.session.sendCustomMessage!(
                  {
                    customType: ASYNC_WAKE_CUSTOM_TYPE,
                    content: input.content,
                    display: false,
                    details: input.details,
                  },
                  { triggerTurn: true },
                ),
        });
      }
    } finally {
      this.turnStreams.finish(streamKey);
      slot.busy = false;
      slot.turnPhase = undefined;
      slot.wakeSources = undefined;
      slot.resolveTurn?.();
      slot.resolveTurn = undefined;
      slot.turnDone = undefined;
      slot.turnAbort = undefined;
      this.emitTurnProgress(input.userId, { type: "done", agentId: input.agentId });
      if (slot.stale) this.disposeKey(key);
      if (!outcome.aborted && !slot.stopRequested) {
        this.wake.onParentIdle(input.userId, input.agentId, input.kind);
      }
    }
  }

  /**
   * SDK 直连的唯一执行入口：保留工具过程/结果，并统一处理中断、超时、HITL 与回写。
   * 返回 false 只表示当前不是 SDK 会话；SDK 起流失败也在本通道内收束，避免退回
   * 只消费最终 result 的 P1 后再次丢失工具过程。
   */
  /** SDK / API 共用：本 visit 发出的委托 started 事件。 */
  private delegationStartedFor(
    userId: string,
    agentId: string,
  ):
    | {
        subscribe: (listener: (event: DelegationStartedEvent) => void) => () => void;
        accept: (event: DelegationStartedEvent) => boolean;
      }
    | undefined {
    if (!this.delegation) return undefined;
    return {
      subscribe: (listener) => this.delegation!.subscribeStarted(listener),
      accept: (event) => event.userId === userId && event.fromAgentId === agentId,
    };
  }

  private async runExternalSessionTurn(input: {
    slot: Slot;
    text: string;
    userText?: string;
    signal?: AbortSignal;
    write: (chunks: UIMessageChunk[]) => void;
    locale?: UiLocale | string | null;
    errorPolicy: "prompt" | "wake" | "propagate";
    outcome?: { aborted: boolean };
    onDirty?: () => void;
    accept: (request: {
      userId: string;
      agentId: string;
      origin?: "visit" | "delegation";
      parentAgentId?: string;
      taskId?: string;
      groupId?: string;
    }) => boolean;
    label?: (request: { origin?: string; taskId?: string }) => {
      askedByName?: string;
      taskLabel?: string;
    };
    delegationStarted?: {
      subscribe: (listener: (event: DelegationStartedEvent) => void) => () => void;
      accept: (event: DelegationStartedEvent) => boolean;
    };
  }): Promise<boolean> {
    if (!input.slot.session.externalQuery) return false;
    const abortTurn = () => input.slot.turnAbort?.abort();
    if (input.signal?.aborted) abortTurn();
    else input.signal?.addEventListener("abort", abortTurn, { once: true });
    const turnSignal = input.slot.turnAbort?.signal ?? input.signal;
    try {
      await runExternalPromptTurn({
        session: input.slot.session,
        text: input.text,
        ...(input.userText ? { userText: input.userText } : {}),
        ...(turnSignal ? { signal: turnSignal } : {}),
        write: input.write,
        ...(input.locale ? { locale: input.locale } : {}),
        errorPolicy: input.errorPolicy,
        ...(input.outcome ? { outcome: input.outcome } : {}),
        ...(input.onDirty ? { onDirty: input.onDirty } : {}),
        hitl: {
          accept: input.accept,
          ...(input.label ? { label: input.label } : {}),
          ...(this.approvals ? { approvals: this.approvals } : {}),
          ...(this.askUser ? { askUser: this.askUser } : {}),
        },
        ...(input.delegationStarted ? { delegationStarted: input.delegationStarted } : {}),
      });
      return true;
    } finally {
      input.signal?.removeEventListener("abort", abortTurn);
    }
  }

  /**
   * 一次性消费 followUp 队列：按排队顺序用 `\n` 拼成**一条**消息，只开一轮
   * （用户改的语义：一串连贯意图不该被切成好几轮，见 .cursor/skills/agentup-sdk-adapter/references/follow-up.md）。
   * 这一轮没有 HTTP 消费者，输出走 turnStreams 旁路，桌面连 /turn-stream 就能看到。
   */
  private async drainFollowUps(visit: Visit, model: ModelConfig): Promise<void> {
    const key = visitKey(visit.userId, visit.agentId, visit.kind);
    const slot = this.sessions.get(key);
    // 会话没了 / 还在跑 / 已被作废 / 换了模型：都不抢，交给下一次正常 prompt
    if (!slot || slot.busy || slot.stale) return;
    if (slot.modelKey !== slotModelKey(model)) return;
    const items = slot.followUps.drainAll();
    if (items.length === 0) return;
    // 顺序 = 排队顺序；拼成一条后整串一起发
    const text = items.map((item) => item.text).join("\n");
    slot.stopRequested = false;
    slot.turnAbort = new AbortController();
    slot.busy = true;
    slot.turnPhase = "wake";
    slot.turnDone = new Promise<void>((resolve) => {
      slot.resolveTurn = resolve;
    });
    const streamKey = TurnStreamHub.key(visit.userId, visit.agentId);
    this.turnStreams.begin(streamKey);
    this.emitTurnProgress(visit.userId, { type: "dirty", agentId: visit.agentId, phase: "wake" });
    const write = (chunks: UIMessageChunk[]) => this.turnStreams.write(streamKey, chunks);
    // 先把用户这条也发过去：桌面据此在助手气泡**之前**渲染用户气泡（顺序 = 用户 → 助手）
    write([
      {
        type: "data-agentup-follow-up-sent",
        data: { text, ids: items.map((item) => item.id) },
      } as UIMessageChunk,
    ]);
    let completed = false;
    try {
      const skills = slot.session.resourceLoader?.getSkills().skills ?? [];
      const expanded = expandSkillReferences(text, skills);
      const onDirty = () => {
        this.emitTurnProgress(visit.userId, {
          type: "dirty",
          agentId: visit.agentId,
          phase: "wake",
        });
      };
      const external = await this.runExternalSessionTurn({
        slot,
        text: expanded,
        userText: text,
        write,
        errorPolicy: "wake",
        onDirty,
        accept: (request) =>
          request.userId === visit.userId && isVisitOwnHitl(request, visit.agentId),
      });
      if (!external) {
        await runObservedTurn({
          session: slot.session,
          write,
          errorPolicy: "wake",
          dirty: "wake",
          onDirty,
          hitl: {
            accept: (request) =>
              request.userId === visit.userId && isVisitOwnHitl(request, visit.agentId),
            approvals: this.approvals,
            askUser: this.askUser,
            shellHang: this.shellHang,
          },
          run: () =>
            slot.session.prompt(expanded, {
              expandPromptTemplates: false,
            }),
        });
      }
      completed = !slot.stopRequested;
    } catch {
      // wake 策略已经把失败写进流；这里只收口，别让异常冒到 promptStream 的 finally
    } finally {
      if (!completed) slot.followUps.restoreFront(items);
      this.turnStreams.finish(streamKey);
      slot.busy = false;
      slot.turnPhase = undefined;
      slot.resolveTurn?.();
      slot.resolveTurn = undefined;
      slot.turnDone = undefined;
      slot.turnAbort = undefined;
      this.emitTurnProgress(visit.userId, { type: "done", agentId: visit.agentId });
      if (slot.stale) this.disposeKey(key);
      // 消费轮跑的时候用户又排了新话：与 promptStream 的 finally 同理，接着再开一轮消费，
      // 不能让这些话躺到下次 prompt 才被看见（§12.8.1）
      if (completed && this.sessions.get(key) && slot.followUps.size > 0 && !slot.stopRequested) {
        void this.drainFollowUps(visit, model).catch(() => undefined);
      } else if (!slot.stopRequested) {
        // 一次取空了：不递归，直接交还编排
        this.wake.onParentIdle(visit.userId, visit.agentId, visitKind(visit));
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
