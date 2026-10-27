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
import {
  MAX_DELEGATION_FANOUT,
  type DelegateFanoutItem,
  type DelegateFanoutResult,
  type DelegateRunResult,
  type DelegationTask,
  type RecruitedAgentInfo,
} from "../types.js";
import { materializePendingArtifacts as materializePending } from "./artifacts.js";
import { DelegationError } from "./errors.js";
import { executeDelegationTask } from "./execute.js";
import {
  AGENT_ID,
  fromLocalCard,
  mergePlanned,
  parentKey,
  reuseBlockedMessage,
} from "./helpers.js";
import {
  afterTerminal,
  notifyParent as enqueueParentNotify,
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
    } = {},
  ): DelegationTask[] {
    // 愈合历史：旧版 sync（wait）终态未标 seen/notified，会反复进桌面 toast。
    for (const task of this.store.list(userId)) {
      settleIfSync(this.store, task);
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
        afterTerminal(this.store, this.options.enqueueWake, next);
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
    afterTerminal(this.store, this.options.enqueueWake, updated);
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
  }): Promise<DelegateRunResult> {
    const batch = await this.delegateFanout({
      userId: input.userId,
      fromAgentId: input.fromAgentId,
      items: [{ toAgentId: input.toAgentId, brief: input.brief }],
      wait: input.wait,
      signal: input.signal,
      toolCallId: input.toolCallId,
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
  }): Promise<DelegateFanoutResult> {
    if (input.items.length === 0) {
      throw new DelegationError("tasks 不能为空");
    }
    if (input.items.length > MAX_DELEGATION_FANOUT) {
      throw new DelegationError(`一次最多委托 ${MAX_DELEGATION_FANOUT} 个专家`);
    }

    const roster = await this.listRecruited(input.userId);
    const resolved: Array<{ toAgentId: string; toAgentName: string; brief: string }> = [];
    for (const item of input.items) {
      if (!AGENT_ID.test(item.toAgentId)) {
        throw new DelegationError(`agent_id 无效: ${item.toAgentId}`);
      }
      if (item.toAgentId === input.fromAgentId) {
        throw new DelegationError("不能委托给自己");
      }
      if (item.toAgentId === PERSONAL_ASSISTANT_ID) {
        throw new DelegationError("不能委托给私人助理");
      }
      const brief = item.brief.trim();
      if (!brief) throw new DelegationError("brief 不能为空");
      const card = roster.find((entry) => entry.agentId === item.toAgentId);
      if (!card) {
        throw new DelegationError(`目标不在可用 Agents 列表中: ${item.toAgentId}`);
      }
      resolved.push({
        toAgentId: item.toAgentId,
        toAgentName: card.remark || card.name || item.toAgentId,
        brief,
      });
    }

    // 扇出：仅显式 wait=true 才同步汇合。单项：模型应按耗时设 wait；省略时回落同步（避免漏参整轮空等）。
    const wait = input.items.length > 1 ? input.wait === true : input.wait !== false;

    const planned: Array<{
      item: (typeof resolved)[number];
      existing?: DelegationTask;
    }> = [];
    for (const item of resolved) {
      const active = this.store.list(input.userId).filter(
        (task) =>
          task.fromAgentId === input.fromAgentId &&
          task.toAgentId === item.toAgentId &&
          (task.status === "running" || task.status === "pending_auth"),
      );
      if (active.length > 1) {
        throw new DelegationError(
          `同一专员已有多项进行中的任务（${active.map((task) => task.id).join(", ")}）。请用 steer_delegation 指定 task_id，不要再派一次。`,
        );
      }
      const current = active[0];
      if (!current) {
        planned.push({ item });
        continue;
      }
      const outcome = await this.steer({
        taskId: current.id,
        userId: input.userId,
        fromAgentId: input.fromAgentId,
        note: item.brief,
      });
      if (!outcome.queued) {
        throw new DelegationError(reuseBlockedMessage(outcome.reason, outcome.task.id));
      }
      planned.push({ item, existing: outcome.task });
    }

    const steeredTaskIds = planned.flatMap((slot) => (slot.existing ? [slot.existing.id] : []));
    const toCreate = planned.filter((slot) => !slot.existing);
    if (toCreate.length === 0) {
      return {
        tasks: planned.map((slot) => slot.existing!),
        steeredTaskIds,
      };
    }

    const created: DelegationTask[] = [];
    const visits: Visit[] = [];
    for (const slot of toCreate) {
      const item = slot.item;
      const task = this.store.create({
        userId: input.userId,
        fromAgentId: input.fromAgentId,
        toAgentId: item.toAgentId,
        toAgentName: item.toAgentName,
        brief: item.brief,
        wait,
      });
      this.store.update(task.id, { status: "running" });
      this.owned.add(task.id);
      this.progress.emitStarted({
        taskId: task.id,
        userId: task.userId,
        fromAgentId: task.fromAgentId,
        toAgentId: task.toAgentId,
        toAgentName: task.toAgentName,
        brief: task.brief,
        toolCallId: input.toolCallId,
        wait,
      });
      // 异步也要先在令牌仍绑定时装好 visit，避免 turn 结束后 sync 失败。
      visits.push(await this.syncVisit(task.userId, task.toAgentId));
      created.push(this.store.get(task.id)!);
    }

    const join = wait && steeredTaskIds.length === 0;
    if (!join) {
      for (let i = 0; i < created.length; i += 1) {
        const task = created[i]!;
        const visit = visits[i]!;
        void this.executeTask(task.id, visit, input.signal).catch(() => undefined);
      }
      return {
        tasks: mergePlanned(planned, created.map((task) => this.store.get(task.id)!)),
        steeredTaskIds,
      };
    }

    await Promise.all(
      created.map((task, index) => this.executeTask(task.id, visits[index]!, input.signal)),
    );
    const done = created.map((task) => this.store.get(task.id)!);
    return {
      tasks: done,
      texts: done.map((task) => task.resultSummary ?? ""),
    };
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
}
