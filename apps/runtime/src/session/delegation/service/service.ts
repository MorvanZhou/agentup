import path from "node:path";

import type { UIMessage } from "ai";

import { t } from "../../../i18n/index.js";
import { listDiskSyncedAgents } from "../../../local/agents/disk-synced.js";
import { listLocalAgents } from "../../../local/agents/local-agent.js";
import {
  ensurePersonalAssistant,
  PERSONAL_ASSISTANT_ID,
} from "../../../local/assistant/personal-assistant.js";
import type { Visit } from "../../../package/sync.js";
import { DelegationProgressHub, type DelegationStartedEvent } from "../progress.js";
import { readDelegationHistory } from "../run.js";
import {
  delegationSteerBlock,
  formatDelegationSteerNote,
  STEER_NOTE_MAX,
} from "../steer.js";
import { DelegationStore } from "../store.js";
import type {
  DelegateFanoutItem,
  DelegateFanoutResult,
  DelegateRunResult,
  DelegationTask,
  RecruitedAgentInfo,
} from "../types.js";
import type { DelegationModelPin } from "../../model/assignment.js";
import {
  listUnpresentedDeliverables as listUnpresented,
  markDeliverablesPresented as markPresented,
  materializePendingArtifacts as materializePending,
} from "./artifacts.js";
import { DelegationError } from "./errors.js";
import { executeDelegationTask } from "./execute.js";
import { runDelegateFanout } from "./fanout.js";
import { fromLocalCard, parentKey } from "./helpers.js";
import type { GroupSpeakerModelPlan } from "./model-pin.js";
import {
  afterTerminal,
  notifyParent as enqueueParentNotify,
  settleGroupIfNotified,
  settleIfSync,
} from "./notify.js";
import { DelegationSlots } from "./slots.js";
import type { DelegationServiceOptions, DelegationSteerOutcome } from "./types.js";
import { syncDelegationVisit } from "./visit.js";

/** 任一 Visit 委托已招募 Agent：鉴权、开专家子会话、回注结果。 */
export class DelegationService {
  private readonly store: DelegationStore;
  private readonly slots = new DelegationSlots();
  private readonly tokens = new Map<string, string>();
  /** parentKey -> 正在执行的子 agentId 集合 */
  private readonly nested = new Map<string, Set<string>>();
  /** taskId -> 可独立取消的 AbortController（与父 turn signal 并联） */
  private readonly controllers = new Map<string, AbortController>();
  /** taskId -> 子会话仍在 prompt 中时，可把新要求插进当前这一步之后 */
  private readonly steerers = new Map<string, (note: string) => Promise<void>>();
  /** 本进程创建并开始的任务；重启收尾不得把它标成退出中断。 */
  private readonly owned = new Set<string>();
  /** 用户发言回合需要处置进行中的委托；wake 不置位。 */
  private readonly dispositionArmed = new Set<string>();
  /** 群内任务终态回到群记录，不进一对一唤醒。 */
  private groupTerminal?: (task: DelegationTask) => void;
  /** 群内工作单刚创建，还没开子会话。让群记下 taskId，交回才找得到执掌者。 */
  private groupStarted?: (input: { userId: string; groupId: string; taskId: string }) => void;
  /** 子会话拿到执行槽。之前群里这条消息显示为排队。 */
  private groupRunning?: (input: { userId: string; groupId: string; taskId: string }) => void;
  private groupQueue?: (input: {
    userId: string;
    groupId: string;
    toAgentId: string;
    brief: string;
  }) => void;
  /** 群统一抄本群模型；单配让调用方不写具体模型。 */
  private groupSpeakerModel?: GroupSpeakerModelPlan;
  /**
   * 这名成员本轮已经交回、执掌者还没告诉用户。
   * 再派只会把同一件事重做一遍。
   */
  private groupAwaitingReply?: (input: {
    userId: string;
    groupId: string;
    agentId: string;
  }) => { taskId: string; summary: string } | null;
  /** 群不存在时返回 undefined，避免把群外已招募的人当成可派对象。 */
  private groupMembers?: (input: {
    userId: string;
    groupId: string;
  }) => { agentId: string; name: string }[] | undefined;
  readonly progress = new DelegationProgressHub();

  constructor(private readonly options: DelegationServiceOptions) {
    this.store = new DelegationStore(options.userDataRoot);
  }

  subscribeStarted(listener: (event: DelegationStartedEvent) => void): () => void {
    return this.progress.subscribeStarted(listener);
  }

  /** 下一次该父会话的 prompt 若有进行中委托，结束前必须逐条处置。 */
  armDelegationDisposition(userId: string, fromAgentId: string): void {
    this.dispositionArmed.add(parentKey(userId, fromAgentId));
  }

  clearDelegationDisposition(userId: string, fromAgentId: string): void {
    this.dispositionArmed.delete(parentKey(userId, fromAgentId));
  }

  delegationDispositionArmed(userId: string, fromAgentId: string): boolean {
    return this.dispositionArmed.has(parentKey(userId, fromAgentId));
  }

  setGroupTerminal(handler: (task: DelegationTask) => void): void {
    this.groupTerminal = handler;
  }

  /** 群内工作单的 visit 已装好、子会话还没开跑时调用。 */
  setGroupTaskStarted(
    handler: (input: { userId: string; groupId: string; taskId: string }) => void,
  ): void {
    this.groupStarted = handler;
  }

  setGroupTaskRunning(
    handler: (input: { userId: string; groupId: string; taskId: string }) => void,
  ): void {
    this.groupRunning = handler;
  }

  /** 旧的接班队列。群里现在同时跑多张单，不再把下一位写进这个队列。 */
  setGroupQueue(
    handler: (input: { userId: string; groupId: string; toAgentId: string; brief: string }) => void,
  ): void {
    this.groupQueue = handler;
  }

  setGroupSpeakerModel(handler: GroupSpeakerModelPlan): void {
    this.groupSpeakerModel = handler;
  }

  setGroupAwaitingReply(
    handler: (input: {
      userId: string;
      groupId: string;
      agentId: string;
    }) => { taskId: string; summary: string } | null,
  ): void {
    this.groupAwaitingReply = handler;
  }

  setGroupMembers(
    handler: (input: { userId: string; groupId: string }) => { agentId: string; name: string }[] | undefined,
  ): void {
    this.groupMembers = handler;
  }

  listGroupMembers(
    userId: string,
    groupId: string,
  ): { agentId: string; name: string }[] | undefined {
    return this.groupMembers?.({ userId, groupId });
  }

  private requireGroupMember(userId: string, groupId: string, toAgentId: string): void {
    const members = this.groupMembers?.({ userId, groupId });
    if (!members) throw new DelegationError("群不存在");
    if (!members.some((member) => member.agentId === toAgentId)) {
      throw new DelegationError("不是群成员");
    }
  }

  bindAuth(userId: string, token: string): void {
    this.tokens.set(userId, token);
  }

  unbindAuth(userId: string): void {
    this.tokens.delete(userId);
  }

  isNestedUnder(userId: string, parentAgentId: string, childAgentId: string): boolean {
    const set = this.nested.get(parentKey(userId, parentAgentId));
    return set?.has(childAgentId) === true;
  }

  /** 若 child 正作为某次委托的执行方，返回委托方 agentId。 */
  findNestingParent(userId: string, childAgentId: string): string | undefined {
    const prefix = `${userId}/`;
    for (const [key, children] of this.nested) {
      if (!key.startsWith(prefix) || !children.has(childAgentId)) continue;
      const parentAgentId = key.slice(prefix.length);
      if (parentAgentId) return parentAgentId;
    }
    return undefined;
  }

  /**
   * 登记「父 turn 正在等子委托」。返回清理函数。
   * HITL surface：子审批在父仍 busy 时挂到父会话，避免两侧栏/双 dock。
   */
  markNested(userId: string, parentAgentId: string, childAgentId: string): () => void {
    const parent = parentKey(userId, parentAgentId);
    let children = this.nested.get(parent);
    if (!children) {
      children = new Set();
      this.nested.set(parent, children);
    }
    children.add(childAgentId);
    return () => {
      children.delete(childAgentId);
      if (children.size === 0) this.nested.delete(parent);
    };
  }

  listTasks(
    userId: string,
    options: {
      unseenOnly?: boolean;
      status?: DelegationTask["status"];
      fromAgentId?: string;
      groupId?: string;
    } = {},
  ): DelegationTask[] {
    for (const task of this.store.list(userId)) {
      settleIfSync(this.store, task);
      settleGroupIfNotified(this.store, task);
    }
    return this.store.list(userId, options);
  }

  getTask(taskId: string): DelegationTask | undefined {
    return this.store.get(taskId);
  }

  acknowledge(taskId: string): DelegationTask | undefined {
    return this.store.update(taskId, { seen: true });
  }

  /**
   * 进程退出后盘上仍是 running / pending_auth 的委托没有执行体。
   * 标失败并走终态收尾：异步唤醒父会话说明已中断；同步只闭合，不占「进行中」。
   * 本进程已开始的任务跳过。
   */
  recoverInterrupted(): DelegationTask[] {
    const settled: DelegationTask[] = [];
    for (const userId of this.store.listUserIds()) {
      for (const task of this.store.list(userId)) {
        if (task.status !== "running" && task.status !== "pending_auth") continue;
        if (this.owned.has(task.id) || this.controllers.has(task.id)) continue;
        const next = this.store.update(task.id, {
          status: "failed",
          error: t("work.interruptedByExit"),
        });
        if (!next) continue;
        afterTerminal(this.store, this.options.enqueueWake, next, this.groupTerminal);
        settled.push(this.store.get(task.id) ?? next);
      }
    }
    return settled;
  }

  /**
   * 取消进行中的委托（含排队未开跑）。终态任务原样返回。
   * 异步任务会写回父会话通知；同步任务由父 turn abort 路径覆盖。
   */
  cancel(taskId: string, userId: string): DelegationTask {
    // 确保落盘任务进内存（重启后无 controller 也能标 cancelled）
    this.store.list(userId);
    const task = this.store.get(taskId);
    if (!task || task.userId !== userId) {
      throw new DelegationError("委托任务不存在");
    }
    if (
      task.status === "completed" ||
      task.status === "failed" ||
      task.status === "cancelled"
    ) {
      return task;
    }
    const controller = this.controllers.get(taskId);
    controller?.abort(new Error("用户已取消"));
    const updated =
      this.store.update(taskId, {
        status: "cancelled",
        error: "用户已取消",
      }) ?? task;
    afterTerminal(this.store, this.options.enqueueWake, updated, this.groupTerminal);
    return this.store.get(taskId) ?? updated;
  }

  /**
   * 子会话进入 prompt 后登记。返回解除函数；解除后 steer 不再插入。
   * 不取消任务，也不打断当前这一步。
   */
  bindDelegationSteer(taskId: string, steer: (note: string) => Promise<void>): () => void {
    this.steerers.set(taskId, steer);
    return () => {
      if (this.steerers.get(taskId) === steer) this.steerers.delete(taskId);
    };
  }

  /**
   * 把新要求插进仍在跑的子任务：当前步骤（含已发出的工具调用）结束后、下一次找模型之前送达。
   * 任务未开跑、已结束，或专员正在等用户时不插入。
   */
  async steer(input: {
    taskId: string;
    userId: string;
    fromAgentId: string;
    note: string;
  }): Promise<DelegationSteerOutcome> {
    const note = input.note.trim();
    if (!note) throw new DelegationError("插入内容不能为空");
    if (note.length > STEER_NOTE_MAX) throw new DelegationError("插入内容过长");
    this.store.list(input.userId);
    const task = this.store.get(input.taskId);
    if (!task || task.userId !== input.userId) {
      throw new DelegationError("委托任务不存在");
    }
    if (task.fromAgentId !== input.fromAgentId) {
      throw new DelegationError("只能插入自己派出的任务");
    }
    const block = delegationSteerBlock({
      status: task.status,
      live: this.steerers.has(task.id),
      waitingOnUser: this.waitingOnUser(task),
    });
    if (block) return { queued: false, reason: block, task };
    const steer = this.steerers.get(task.id);
    if (!steer) return { queued: false, reason: "not_started", task };
    try {
      await steer(formatDelegationSteerNote(note));
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "插入失败";
      throw new DelegationError(message);
    }
    return { queued: true, task: this.store.get(task.id) ?? task };
  }

  /** 子会话正卡在审批、提问或命令人审时，不把新要求插进去。 */
  private waitingOnUser(task: DelegationTask): boolean {
    const matches = (item: { origin?: string; taskId?: string }) =>
      item.origin === "delegation" && item.taskId === task.id;
    if (this.options.askUser.listPending(task.userId).some(matches)) return true;
    if (this.options.approvals.listPending(task.userId).some(matches)) return true;
    return this.options.shellHang?.listPending(task.userId).some(matches) === true;
  }

  /** 读取委托隔离子会话的 UIMessage 历史（旁路，不进父会话）。 */
  async readTaskHistory(taskId: string, userId: string): Promise<UIMessage[]> {
    const task = this.store.get(taskId);
    if (!task || task.userId !== userId) {
      throw new DelegationError("委托任务不存在");
    }
    const visitRoot =
      task.toAgentId === PERSONAL_ASSISTANT_ID
        ? ensurePersonalAssistant(this.options.userDataRoot, userId)
        : path.join(this.options.userDataRoot, "users", userId, "agents", task.toAgentId);
    const cwd = path.join(visitRoot, "cwd");
    return readDelegationHistory(visitRoot, taskId, cwd);
  }

  /**
   * 委托 / 发现用的可用专家池：只读本机。
   * 招募时已 sync 到 `users/<uid>/agents/<id>/`；本机私有为 `loc-*`。
   * 不打 backend，避免登录态漏本地、也避免发现依赖网络。
   */
  async listRecruited(userId: string): Promise<RecruitedAgentInfo[]> {
    const byId = new Map<string, RecruitedAgentInfo>();

    for (const card of listLocalAgents(this.options.userDataRoot, userId)) {
      byId.set(card.agentId, fromLocalCard(card));
    }
    for (const item of listDiskSyncedAgents(this.options.userDataRoot, userId)) {
      if (byId.has(item.agentId)) continue;
      byId.set(item.agentId, {
        agentId: item.agentId,
        name: item.name,
        role: item.role,
        background: item.background,
        remark: item.remark,
        ...(item.systemText ? { systemText: item.systemText } : {}),
        ...(item.agentsText ? { agentsText: item.agentsText } : {}),
      });
    }

    return [...byId.values()].sort(
      (a, b) => a.name.localeCompare(b.name, "zh") || a.agentId.localeCompare(b.agentId, "en"),
    );
  }

  /**
   * 创建并执行委托。wait=true 时阻塞到完成；wait=false 时授权后立即返回 task_id，后台跑完再通知。
   */
  async delegate(input: {
    userId: string;
    fromAgentId: string;
    toAgentId: string;
    brief: string;
    wait?: boolean;
    signal?: AbortSignal;
    toolCallId?: string;
    groupId?: string;
  }): Promise<DelegateRunResult> {
    const batch = await this.delegateFanout({
      userId: input.userId,
      fromAgentId: input.fromAgentId,
      items: [{ toAgentId: input.toAgentId, brief: input.brief }],
      wait: input.wait,
      signal: input.signal,
      toolCallId: input.toolCallId,
      groupId: input.groupId,
    });
    const task = batch.tasks[0];
    if (!task) throw new DelegationError("委托失败");
    return {
      task,
      text: batch.texts?.[0],
      steered: batch.steeredTaskIds?.includes(task.id) === true,
    };
  }

  /**
   * 批量扇出：多项专家并行（受 MAX_DELEGATION_CONCURRENT 闸门）。
   * 默认 wait=false（立刻返回 task_id）；wait=true 则等全部完成。
   */
  async delegateFanout(input: {
    userId: string;
    fromAgentId: string;
    items: DelegateFanoutItem[];
    wait?: boolean;
    signal?: AbortSignal;
    toolCallId?: string;
    groupId?: string;
    modelPin?: DelegationModelPin;
  }): Promise<DelegateFanoutResult> {
    return runDelegateFanout(
      {
        store: this.store,
        progress: this.progress,
        owned: this.owned,
        userDataRoot: this.options.userDataRoot,
        getModel: this.options.getModel,
        listRecruited: (userId) => this.listRecruited(userId),
        requireGroupMember: (userId, groupId, toAgentId) =>
          this.requireGroupMember(userId, groupId, toAgentId),
        groupAwaitingReply: this.groupAwaitingReply,
        groupSpeakerModel: this.groupSpeakerModel,
        groupStarted: this.groupStarted,
        steer: (steerInput) => this.steer(steerInput),
        syncVisit: (userId, agentId) => this.syncVisit(userId, agentId),
        executeTask: (taskId, visit, signal) => this.executeTask(taskId, visit, signal),
      },
      input,
    );
  }

  private async executeTask(taskId: string, visit: Visit, signal?: AbortSignal): Promise<void> {
    return executeDelegationTask(
      {
        store: this.store,
        slots: this.slots,
        controllers: this.controllers,
        userDataRoot: this.options.userDataRoot,
        getModel: this.options.getModel,
        approvals: this.options.approvals,
        askUser: this.options.askUser,
        shellHang: this.options.shellHang,
        enqueueWake: this.options.enqueueWake,
        progress: this.progress,
        markNested: (userId, parentAgentId, childAgentId) =>
          this.markNested(userId, parentAgentId, childAgentId),
        bindSteer: (taskIdInner, steer) => this.bindDelegationSteer(taskIdInner, steer),
        onGroup: (task) => this.groupTerminal?.(task),
        onGroupRunning: (task) => {
          if (!task.groupId) return;
          this.groupRunning?.({ userId: task.userId, groupId: task.groupId, taskId: task.id });
        },
      },
      taskId,
      visit,
      signal,
    );
  }

  private async syncVisit(userId: string, agentId: string): Promise<Visit> {
    return syncDelegationVisit({
      userDataRoot: this.options.userDataRoot,
      backendUrl: this.options.backendUrl,
      tokens: this.tokens,
      userId,
      agentId,
    });
  }

  /**
   * 异步结果 → 空闲唤醒队列（Pi display:false + triggerTurn）。
   * 不再 appendCustomMessageEntry 进可见历史。
   * sync（wait=true）结果已作 tool result，不走 wake。
   */
  notifyParent(task: DelegationTask): void {
    enqueueParentNotify(this.store, this.options.enqueueWake, task);
  }

  /**
   * 父会话 agent_start：把尚未落盘的委托附件拷入 parentCwd。
   * 须在 createArtifactsExtension 快照之后调用。
   */
  materializePendingArtifacts(userId: string, fromAgentId: string, parentCwd: string): void {
    materializePending(
      this.store,
      this.options.userDataRoot,
      userId,
      fromAgentId,
      parentCwd,
    );
  }

  /** 收口网格：尚未 presented 的 deliveredPaths。 */
  listUnpresentedDeliverables(userId: string, fromAgentId: string) {
    return listUnpresented(this.store, userId, fromAgentId);
  }

  markDeliverablesPresented(taskIds: readonly string[]): void {
    markPresented(this.store, taskIds);
  }
}
