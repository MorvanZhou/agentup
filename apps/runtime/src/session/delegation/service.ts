import fs from "node:fs";
import path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import type { UIMessage } from "ai";

import type { ModelConfig } from "../../config/load.js";
import { HttpPackageSource, listAgents } from "../../control/client.js";
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
   * kind: personal | recruited
   */
  invalidateVisit?: (userId: string, agentId: string, kind: "personal" | "recruited") => void;
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

  async listRecruited(userId: string): Promise<RecruitedAgentInfo[]> {
    const token = this.tokens.get(userId);
    if (token) {
      try {
        const agents = await listAgents(this.options.backendUrl, token, { recruited: true });
        return agents.map((agent) => ({
          agentId: agent.agentId,
          name: agent.name,
          summary: agent.summary,
          remark: agent.remark,
        }));
      } catch {
        // 退回本机已同步目录
      }
    }
    return listLocalRecruited(this.options.userDataRoot, userId);
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
    const toAgentName = card?.name || card?.remark || input.toAgentId;
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

    const parent = parentKey(task.userId, task.fromAgentId);
    let children = this.nested.get(parent);
    if (!children) {
      children = new Set();
      this.nested.set(parent, children);
    }
    children.add(task.toAgentId);

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
      children.delete(task.toAgentId);
      if (children.size === 0) this.nested.delete(parent);
    }
  }

  private async syncVisit(userId: string, agentId: string): Promise<Visit> {
    const token = this.tokens.get(userId);
    if (token) {
      return new Runtime(
        new HttpPackageSource(this.options.backendUrl, token),
        this.options.userDataRoot,
      ).sync(userId, agentId);
    }
    // 无令牌时仅使用本机已投影的 visit（异步后台可能已解绑 token）。
    const root = path.join(this.options.userDataRoot, "users", userId, "agents", agentId);
    const instance = path.join(root, "instance.json");
    if (!fs.existsSync(instance)) {
      throw new DelegationError("尚未同步该 Agent，请先打开或同步后再委托");
    }
    const data = JSON.parse(fs.readFileSync(instance, "utf8")) as Record<string, unknown>;
    return {
      kind: "recruited",
      userId,
      agentId,
      root,
      packageVersion: typeof data.package_version === "number" ? data.package_version : 0,
      packageDigest: typeof data.package_digest === "string" ? data.package_digest : "",
      tools: Array.isArray(data.tools) ? data.tools.map(String) : [],
      modelCapabilities: Array.isArray(data.model_capabilities)
        ? data.model_capabilities.map(String)
        : [],
      projectTrust: typeof data.project_trust === "string" ? data.project_trust : "granted",
    };
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
        personal ? "personal" : "recruited",
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

function listLocalRecruited(userDataRoot: string, userId: string): RecruitedAgentInfo[] {
  const root = path.join(userDataRoot, "users", userId, "agents");
  if (!fs.existsSync(root)) return [];
  const result: RecruitedAgentInfo[] = [];
  for (const name of fs.readdirSync(root)) {
    if (!AGENT_ID.test(name)) continue;
    const instance = path.join(root, name, "instance.json");
    if (!fs.existsSync(instance)) continue;
    const systemPath = path.join(root, name, "cwd", ".pi", "SYSTEM.md");
    let summary = "";
    if (fs.existsSync(systemPath)) {
      const first = fs.readFileSync(systemPath, "utf8").split(/\r?\n/).find((line) => line.trim());
      summary = first ? first.replace(/^#+\s*/, "").trim().slice(0, 200) : "";
    }
    result.push({ agentId: name, name, summary, remark: "" });
  }
  return result;
}
