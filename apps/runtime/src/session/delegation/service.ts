import fs from "node:fs";
import path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import type { UIMessage } from "ai";

import type { ModelConfig } from "../../config/load.js";
import { HttpPackageSource } from "../../control/client.js";
import { composeSystemPrompt } from "../../local/agent-identity.js";
import { listDiskSyncedAgents } from "../../local/disk-synced-agents.js";
import {
  isLocalAgentId,
  listLocalAgents,
  localAgentVisit,
  type LocalAgentCard,
} from "../../local/local-agent.js";
import { ensurePersonalAssistant, PERSONAL_ASSISTANT_ID } from "../../local/personal-assistant.js";
import { Runtime, type Visit } from "../../package/sync.js";
import type { ApprovalBroker } from "../approval.js";
import type { AskUserBroker } from "../tools/ask-user.js";
import { DelegationProgressHub, type DelegationStartedEvent } from "./progress.js";
import { readDelegationHistory, runDelegatedPrompt } from "./run.js";
import { DelegationStore } from "./store.js";
import {
  DELEGATION_RESULT_CUSTOM_TYPE,
  type DelegateRunResult,
  type DelegationTask,
  type RecruitedAgentInfo,
} from "./types.js";

const AGENT_ID = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
export { DELEGATION_RESULT_CUSTOM_TYPE };

export type DelegationServiceOptions = {
  userDataRoot: string;
  backendUrl: string;
  getModel: () => ModelConfig;
  approvals: ApprovalBroker;
  askUser: AskUserBroker;
  /**
   * 异步完成后作废委托方内存会话，便于历史重载看见通知。
   * kind: personal | recruited | local
   */
  invalidateVisit?: (
    userId: string,
    agentId: string,
    kind: "personal" | "recruited" | "local",
  ) => void;
};

/** 任一 Visit 委托已招募 Agent：鉴权、开专家子会话、回注结果。 */
export class DelegationService {
  private readonly store: DelegationStore;
  private readonly tokens = new Map<string, string>();
  /** parentKey -> 正在执行的子 agentId 集合 */
  private readonly nested = new Map<string, Set<string>>();
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
    options: { unseenOnly?: boolean; status?: DelegationTask["status"] } = {},
  ): DelegationTask[] {
    return this.store.list(userId, options);
  }

  getTask(taskId: string): DelegationTask | undefined {
    return this.store.get(taskId);
  }

  acknowledge(taskId: string): DelegationTask | undefined {
    return this.store.update(taskId, { seen: true });
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
    if (!AGENT_ID.test(input.toAgentId)) {
      throw new DelegationError("agent_id 无效");
    }
    if (input.toAgentId === input.fromAgentId) {
      throw new DelegationError("不能委托给自己");
    }
    if (input.toAgentId === PERSONAL_ASSISTANT_ID) {
      throw new DelegationError("不能委托给私人助理");
    }
    const brief = input.brief.trim();
    if (!brief) throw new DelegationError("brief 不能为空");

    const roster = await this.listRecruited(input.userId);
    const card = roster.find((item) => item.agentId === input.toAgentId);
    if (!card) {
      throw new DelegationError("目标不在可用 Agents 列表中（需为本机或已招募专家）");
    }
    const toAgentName = card.remark || card.name || input.toAgentId;
    const wait = input.wait !== false;

    const task = this.store.create({
      userId: input.userId,
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      toAgentName,
      brief,
      wait,
    });

    // 审批由 ApprovalBroker 在 tool_call 钩子里拦截；此处假定已放行后进入 execute。
    this.store.update(task.id, { status: "running" });

    // 旁路：父流只收 started（transient），过程走 progress hub，不进父消息。
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

    // 异步任务也要先在令牌仍绑定时装好 visit，避免 turn 结束后 sync 失败。
    const visit = await this.syncVisit(task.userId, task.toAgentId);

    if (!wait) {
      void this.executeTask(task.id, visit, input.signal).catch(() => undefined);
      const current = this.store.get(task.id)!;
      return { task: current };
    }

    await this.executeTask(task.id, visit, input.signal);
    const done = this.store.get(task.id)!;
    return {
      task: done,
      text: done.resultSummary,
    };
  }

  private async executeTask(taskId: string, visit: Visit, signal?: AbortSignal): Promise<void> {
    const task = this.store.get(taskId);
    if (!task) return;

    const unmark = this.markNested(task.userId, task.fromAgentId, task.toAgentId);

    try {
      const outcome = await runDelegatedPrompt(
        visit,
        this.options.getModel(),
        task.brief,
        this.options.approvals,
        this.options.askUser,
        { taskId: task.id, signal, progress: this.progress },
      );
      if (outcome.error && !outcome.text) {
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
      const message = error instanceof Error && error.message ? error.message : "委托失败";
      this.store.update(task.id, { status: "failed", error: message });
      const finished = this.store.get(task.id);
      if (finished && !finished.wait) {
        this.notifyParent(finished);
      }
    } finally {
      unmark();
    }
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

  /** 把异步结果写入委托方当前会话，供下次上下文与历史展示。 */
  notifyParent(task: DelegationTask): void {
    if (task.notified) return;
    if (task.status !== "completed" && task.status !== "failed") return;
    try {
      const personal = task.fromAgentId === PERSONAL_ASSISTANT_ID;
      const root = personal
        ? ensurePersonalAssistant(this.options.userDataRoot, task.userId)
        : path.join(this.options.userDataRoot, "users", task.userId, "agents", task.fromAgentId);
      const cwd = path.join(root, "cwd");
      const sessionDir = path.join(root, "sessions");
      fs.mkdirSync(cwd, { recursive: true });
      fs.mkdirSync(sessionDir, { recursive: true });
      const manager = SessionManager.continueRecent(cwd, sessionDir);
      const body =
        task.status === "completed"
          ? `【委托完成】专家「${task.toAgentName}」（${task.toAgentId}）已完成子任务。\n\n` +
            `任务：${task.brief}\n\n结果：\n${task.resultSummary ?? ""}`
          : `【委托失败】专家「${task.toAgentName}」（${task.toAgentId}）未能完成子任务。\n\n` +
            `任务：${task.brief}\n\n原因：${task.error ?? "未知错误"}` +
            (task.resultSummary ? `\n\n部分输出：\n${task.resultSummary}` : "");
      manager.appendCustomMessageEntry(
        DELEGATION_RESULT_CUSTOM_TYPE,
        body,
        true,
        {
          taskId: task.id,
          toAgentId: task.toAgentId,
          toAgentName: task.toAgentName,
          status: task.status,
        },
      );
      this.store.update(task.id, { notified: true });
      this.options.invalidateVisit?.(
        task.userId,
        task.fromAgentId,
        personal ? "personal" : isLocalAgentId(task.fromAgentId) ? "local" : "recruited",
      );
    } catch {
      // 通知失败不改变任务终态；桌面仍可通过 /delegations 拉取。
    }
  }
}

export class DelegationError extends Error {}

function parentKey(userId: string, agentId: string): string {
  return `${userId}/${agentId}`;
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
