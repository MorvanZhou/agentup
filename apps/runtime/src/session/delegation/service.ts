import path from "node:path";

import type { UIMessage } from "ai";

import type { ModelConfig } from "../../config/load.js";
import { HttpPackageSource } from "../../control/client.js";
import { composeSystemPrompt } from "../../local/agents/identity.js";
import { listDiskSyncedAgents } from "../../local/agents/disk-synced.js";
import {
  isLocalAgentId,
  listLocalAgents,
  localAgentVisit,
  type LocalAgentCard,
} from "../../local/agents/local-agent.js";
import { ensurePersonalAssistant, PERSONAL_ASSISTANT_ID } from "../../local/assistant/personal-assistant.js";
import { Runtime, type Visit } from "../../package/sync.js";
import type { ApprovalBroker } from "../hitl/approval/index.js";
import type { AskUserBroker } from "../tools/ask-user.js";
import type { AsyncWakeItem } from "../wake/index.js";
import { DelegationProgressHub, type DelegationStartedEvent } from "./progress.js";
import { readDelegationHistory, runDelegatedPrompt } from "./run.js";
import { DelegationStore } from "./store.js";
import {
  DELEGATION_RESULT_CUSTOM_TYPE,
  MAX_DELEGATION_CONCURRENT,
  MAX_DELEGATION_FANOUT,
  type DelegateFanoutItem,
  type DelegateFanoutResult,
  type DelegateRunResult,
  type DelegationTask,
  type RecruitedAgentInfo,
} from "./types.js";

const AGENT_ID = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
export { DELEGATION_RESULT_CUSTOM_TYPE, MAX_DELEGATION_CONCURRENT, MAX_DELEGATION_FANOUT };

export type DelegationServiceOptions = {
  userDataRoot: string;
  backendUrl: string;
  getModel: () => ModelConfig;
  approvals: ApprovalBroker;
  askUser: AskUserBroker;
  /**
   * 异步完成：排队空闲唤醒（不写可见历史气泡）。
   * list/ack 若尚未 notified 会再调 notifyParent 做恢复。
   */
  enqueueWake?: (item: AsyncWakeItem) => void;
};

/** 任一 Visit 委托已招募 Agent：鉴权、开专家子会话、回注结果。 */
export class DelegationService {
  private readonly store: DelegationStore;
  private readonly tokens = new Map<string, string>();
  /** parentKey -> 正在执行的子 agentId 集合 */
  private readonly nested = new Map<string, Set<string>>();
  /** userId -> 当前占用的并发槽位数 */
  private readonly activeSlots = new Map<string, number>();
  /** userId -> 等待并发槽的 resolve 队列 */
  private readonly slotWaiters = new Map<string, Array<() => void>>();
  /** taskId -> 可独立取消的 AbortController（与父 turn signal 并联） */
  private readonly controllers = new Map<string, AbortController>();
  readonly progress = new DelegationProgressHub();

  constructor(private readonly options: DelegationServiceOptions) {
    this.store = new DelegationStore(options.userDataRoot);
  }

  subscribeStarted(listener: (event: DelegationStartedEvent) => void): () => void {
    return this.progress.subscribeStarted(listener);
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
    return this.store.list(userId, options);
  }

  getTask(taskId: string): DelegationTask | undefined {
    return this.store.get(taskId);
  }

  acknowledge(taskId: string): DelegationTask | undefined {
    return this.store.update(taskId, { seen: true });
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
    if (!updated.wait) {
      this.notifyParent(updated);
    }
    return this.store.get(taskId) ?? updated;
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
    return { task, text: batch.texts?.[0] };
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

    const created: DelegationTask[] = [];
    const visits: Visit[] = [];
    for (const item of resolved) {
      const task = this.store.create({
        userId: input.userId,
        fromAgentId: input.fromAgentId,
        toAgentId: item.toAgentId,
        toAgentName: item.toAgentName,
        brief: item.brief,
        wait,
      });
      this.store.update(task.id, { status: "running" });
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

    if (!wait) {
      for (let i = 0; i < created.length; i += 1) {
        const task = created[i]!;
        const visit = visits[i]!;
        void this.executeTask(task.id, visit, input.signal).catch(() => undefined);
      }
      return { tasks: created.map((task) => this.store.get(task.id)!) };
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
    const task = this.store.get(taskId);
    if (!task) return;

    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    const linked = linkAbortSignals(signal, controller.signal);

    try {
      await this.acquireSlot(task.userId, linked);
      // 排队期间被取消：acquire 抛错或状态已 cancelled
      if (this.store.get(taskId)?.status === "cancelled" || linked.aborted) {
        const cancelled = this.store.update(taskId, {
          status: "cancelled",
          error: "用户已取消",
        });
        if (cancelled && !cancelled.wait) this.notifyParent(cancelled);
        return;
      }

      const unmark = this.markNested(task.userId, task.fromAgentId, task.toAgentId);
      try {
        const outcome = await runDelegatedPrompt(
          visit,
          this.options.getModel(),
          task.brief,
          this.options.approvals,
          this.options.askUser,
          {
            taskId: task.id,
            parentAgentId: task.fromAgentId,
            signal: linked,
            progress: this.progress,
          },
        );
        const latest = this.store.get(task.id);
        if (latest?.status === "cancelled") {
          if (!latest.wait) this.notifyParent(latest);
          return;
        }
        const cancelled =
          linked.aborted ||
          (typeof outcome.error === "string" && /取消|abort|cancelled/i.test(outcome.error));
        if (cancelled) {
          this.store.update(task.id, {
            status: "cancelled",
            error: "用户已取消",
            resultSummary: outcome.text || undefined,
          });
        } else if (outcome.error && !outcome.text) {
          this.store.update(task.id, { status: "failed", error: outcome.error, resultSummary: "" });
        } else if (outcome.error) {
          this.store.update(task.id, {
            status: "failed",
            error: outcome.error,
            resultSummary: outcome.text,
          });
        } else {
          this.store.update(task.id, {
            status: "completed",
            resultSummary: outcome.text,
            error: undefined,
          });
        }
        const finished = this.store.get(task.id);
        if (finished && !finished.wait) {
          this.notifyParent(finished);
        }
      } catch (error) {
        const latest = this.store.get(task.id);
        if (latest?.status === "cancelled") {
          if (!latest.wait) this.notifyParent(latest);
          return;
        }
        const aborted = linked.aborted;
        const message = aborted
          ? "用户已取消"
          : error instanceof Error && error.message
            ? error.message
            : "委托失败";
        this.store.update(task.id, {
          status: aborted ? "cancelled" : "failed",
          error: message,
        });
        const finished = this.store.get(task.id);
        if (finished && !finished.wait) {
          this.notifyParent(finished);
        }
      } finally {
        unmark();
        this.releaseSlot(task.userId);
      }
    } catch (error) {
      // acquireSlot 因 abort 拒绝
      const latest = this.store.get(taskId);
      if (latest?.status === "cancelled") {
        if (!latest.wait) this.notifyParent(latest);
        return;
      }
      const aborted = linked.aborted;
      const message = aborted
        ? "用户已取消"
        : error instanceof Error && error.message
          ? error.message
          : "委托失败";
      const finished = this.store.update(taskId, {
        status: aborted ? "cancelled" : "failed",
        error: message,
      });
      if (finished && !finished.wait) this.notifyParent(finished);
    } finally {
      this.controllers.delete(taskId);
    }
  }

  private async acquireSlot(userId: string, signal?: AbortSignal): Promise<void> {
    const active = this.activeSlots.get(userId) ?? 0;
    if (active < MAX_DELEGATION_CONCURRENT) {
      this.activeSlots.set(userId, active + 1);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiters = this.slotWaiters.get(userId) ?? [];
      const resume = () => {
        signal?.removeEventListener("abort", onAbort);
        const current = this.activeSlots.get(userId) ?? 0;
        this.activeSlots.set(userId, current + 1);
        resolve();
      };
      const onAbort = () => {
        const list = this.slotWaiters.get(userId);
        if (list) {
          const index = list.indexOf(resume);
          if (index >= 0) list.splice(index, 1);
        }
        reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
      };
      waiters.push(resume);
      this.slotWaiters.set(userId, waiters);
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private releaseSlot(userId: string): void {
    const active = this.activeSlots.get(userId) ?? 0;
    const next = Math.max(0, active - 1);
    if (next === 0) this.activeSlots.delete(userId);
    else this.activeSlots.set(userId, next);
    const waiters = this.slotWaiters.get(userId);
    const resume = waiters?.shift();
    if (waiters && waiters.length === 0) this.slotWaiters.delete(userId);
    resume?.();
  }

  private async syncVisit(userId: string, agentId: string): Promise<Visit> {
    if (isLocalAgentId(agentId)) {
      try {
        return localAgentVisit(this.options.userDataRoot, userId, agentId);
      } catch {
        throw new DelegationError("找不到本机 Agent");
      }
    }
    const token = this.tokens.get(userId);
    if (token) {
      try {
        return await new Runtime(
          new HttpPackageSource(this.options.backendUrl, token),
          this.options.userDataRoot,
        ).sync(userId, agentId);
      } catch {
        const disk = Runtime.openDiskVisit(this.options.userDataRoot, userId, agentId);
        if (disk) return disk;
        throw new DelegationError("同步 Agent 失败，且本机无可用投影");
      }
    }
    // 无令牌时仅使用本机已投影的 visit（异步后台可能已解绑 token）。
    const disk = Runtime.openDiskVisit(this.options.userDataRoot, userId, agentId);
    if (!disk) {
      throw new DelegationError("尚未同步该 Agent，请先打开或同步后再委托");
    }
    return disk;
  }

  /**
   * 异步结果 → 空闲唤醒队列（Pi display:false + triggerTurn）。
   * 不再 appendCustomMessageEntry 进可见历史。
   */
  notifyParent(task: DelegationTask): void {
    if (task.notified) return;
    if (
      task.status !== "completed" &&
      task.status !== "failed" &&
      task.status !== "cancelled"
    ) {
      return;
    }
    if (!this.options.enqueueWake) return;
    const personal = task.fromAgentId === PERSONAL_ASSISTANT_ID;
    const kind: AsyncWakeItem["kind"] = personal
      ? "personal"
      : isLocalAgentId(task.fromAgentId)
        ? "local"
        : "recruited";
    const body =
      task.status === "completed"
        ? `【委托完成】专家「${task.toAgentName}」（${task.toAgentId}）已完成子任务。\n\n` +
          `任务：${task.brief}\n\n结果：\n${task.resultSummary ?? ""}`
        : task.status === "cancelled"
          ? `【委托已取消】专家「${task.toAgentName}」（${task.toAgentId}）的子任务已停止。\n\n` +
            `任务：${task.brief}` +
            (task.resultSummary ? `\n\n部分输出：\n${task.resultSummary}` : "")
          : `【委托失败】专家「${task.toAgentName}」（${task.toAgentId}）未能完成子任务。\n\n` +
            `任务：${task.brief}\n\n原因：${task.error ?? "未知错误"}` +
            (task.resultSummary ? `\n\n部分输出：\n${task.resultSummary}` : "");
    this.options.enqueueWake({
      id: `delegation:${task.id}`,
      userId: task.userId,
      agentId: task.fromAgentId,
      kind,
      urgency: task.status === "completed" ? "batch" : "immediate",
      body,
      details: {
        customType: DELEGATION_RESULT_CUSTOM_TYPE,
        taskId: task.id,
        toAgentId: task.toAgentId,
        toAgentName: task.toAgentName,
        status: task.status,
      },
      markDelivered: () => {
        this.store.update(task.id, { notified: true });
      },
    });
  }
}

export class DelegationError extends Error {}

function parentKey(userId: string, agentId: string): string {
  return `${userId}/${agentId}`;
}

/** 任一 signal abort 则合成 abort；用于父 turn + 任务级取消并联。 */
function linkAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal {
  const active = signals.filter((item): item is AbortSignal => Boolean(item));
  if (active.length === 0) return new AbortController().signal;
  if (active.length === 1) return active[0]!;
  const merged = new AbortController();
  const onAbort = () => {
    if (!merged.signal.aborted) {
      const reason = active.find((item) => item.aborted)?.reason;
      merged.abort(reason);
    }
  };
  for (const signal of active) {
    if (signal.aborted) {
      onAbort();
      break;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return merged.signal;
}

function fromLocalCard(card: LocalAgentCard): RecruitedAgentInfo {
  const name = card.name.trim();
  const role = card.role.trim();
  const background = card.background.trim();
  return {
    agentId: card.agentId,
    name,
    role,
    background,
    remark: "",
    systemText:
      name && role && background
        ? composeSystemPrompt({ name, role, background }, "zh")
        : undefined,
  };
}
