import { randomUUID } from "node:crypto";

import {
  clearSessionCommandAllow,
  clearSessionDelegationAllow,
  clearSessionDelegationAllowForTarget,
  clearSessionPathMountAllow,
  clearSessionToolAllow,
  getCommandAllow,
  getDelegationAllow,
  getPathMountAllow,
  getToolAllow,
  setCommandAllow,
  setDelegationAllow,
  setPathMountAllow,
  setToolAllow,
} from "../../../local/user/state.js";
import { addProjectRoot } from "../../workspace/project-roots.js";
import { readHitlPending, writeHitlApprovals } from "../pending.js";
import { hasDanglingToolCall, repairOrphanApproval } from "../repair.js";
import {
  delegationKey,
  isCommandTool,
  isDelegationTool,
  isMcpTool,
  isProjectMountArgs,
  mcpServerAllowKey,
  targetAgentIds,
  toolKey,
  visitKey,
} from "./tools.js";
import type { ApprovalRequest, ApprovalScope } from "./types.js";

export class ApprovalBroker {
  private readonly pending = new Map<
    string,
    { request: ApprovalRequest; resolve: (allowed: boolean) => void; cleanup: () => void }
  >();
  /** 进程重启后仍挂在盘上、且会话里 toolCall 仍悬空的请求（无 Promise）。 */
  private readonly orphans = new Map<string, ApprovalRequest>();
  private readonly listeners = new Set<(request: ApprovalRequest) => void>();
  /** 无持久化目录时的进程内回退（单测用）。 */
  private readonly memoryAllow = new Map<string, "session" | "agent">();
  private readonly memoryDelegationAllow = new Map<string, "session" | "agent">();
  private readonly memoryToolAllow = new Map<string, "session" | "agent">();
  private readonly memoryPathMountAllow = new Map<string, "session" | "agent">();
  private readonly restoredUsers = new Set<string>();

  constructor(private readonly userDataRoot?: string) {}

  /** 载入某用户盘上仍可闭合的审批（A：已愈合的丢弃）。每用户只跑一次。 */
  restoreUser(userId: string): void {
    if (!this.userDataRoot || !userId || this.restoredUsers.has(userId)) return;
    this.restoredUsers.add(userId);
    const stored = readHitlPending(this.userDataRoot, userId);
    for (const request of stored.approvals) {
      if (this.pending.has(request.id) || this.orphans.has(request.id)) continue;
      if (!hasDanglingToolCall(this.userDataRoot, request.userId, request.agentId, request.toolCallId)) {
        continue;
      }
      this.orphans.set(request.id, request);
    }
    this.persistUser(userId);
  }

  request(request: Omit<ApprovalRequest, "id">, signal?: AbortSignal): Promise<boolean | undefined> {
    const value = { ...request, id: randomUUID() };
    this.restoredUsers.add(value.userId);
    return new Promise((resolve) => {
      const abort = () => {
        this.pending.delete(value.id);
        this.persistUser(value.userId);
        resolve(undefined);
      };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        resolve(undefined);
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(value.id, { request: value, resolve, cleanup });
      this.persistUser(value.userId);
      for (const listener of this.listeners) listener(value);
    });
  }

  decide(id: string, allowed: boolean, scope: ApprovalScope = "once"): boolean {
    const pending = this.pending.get(id);
    if (pending) {
      this.pending.delete(id);
      pending.cleanup();
      if (allowed) {
        this.applyProjectMount(pending.request);
        this.applyGrant(pending.request, scope);
      }
      pending.resolve(allowed);
      this.persistUser(pending.request.userId);
      return true;
    }
    const orphan = this.orphans.get(id);
    if (!orphan || !this.userDataRoot) return false;
    const repaired = repairOrphanApproval(this.userDataRoot, orphan, allowed);
    this.orphans.delete(id);
    if (repaired && allowed) {
      this.applyProjectMount(orphan);
      this.applyGrant(orphan, scope);
    }
    this.persistUser(orphan.userId);
    // 修不上也清掉（A：不可闭合的不留假 blocked）；对 UI 仍算「已处理」。
    return true;
  }

  allowsPathMount(userId: string, agentId: string): boolean {
    return this.pathMountScope(userId, agentId) !== undefined;
  }

  listPending(userId: string): ApprovalRequest[] {
    if (this.userDataRoot) this.restoreUser(userId);
    const byId = new Map<string, ApprovalRequest>();
    for (const { request } of this.pending.values()) {
      if (request.userId === userId) byId.set(request.id, request);
    }
    for (const request of this.orphans.values()) {
      if (request.userId === userId) byId.set(request.id, request);
    }
    return [...byId.values()];
  }

  /** 打开会话愈合时跳过：仍在等用户拍板的 toolCall。 */
  pendingToolCallIds(userId: string, agentId: string): Set<string> {
    const ids = new Set<string>();
    for (const request of this.listPending(userId)) {
      if (request.agentId === agentId) ids.add(request.toolCallId);
    }
    return ids;
  }

  allowsCommand(userId: string, agentId: string): boolean {
    return this.commandScope(userId, agentId) !== undefined;
  }

  allowsTool(userId: string, agentId: string, toolName: string): boolean {
    if (this.toolScope(userId, agentId, toolName) !== undefined) return true;
    // 对话配置可按 MCP server 授权：`mcp__server` 覆盖 `mcp__server__*`。
    const serverKey = mcpServerAllowKey(toolName);
    return Boolean(serverKey && this.toolScope(userId, agentId, serverKey) !== undefined);
  }

  /**
   * 会诊是否已放行：`agent` 级记在 fromAgentId（可调任何人）；
   * `session` 级记在 toAgentId（本对话仅此专家）。
   */
  allowsDelegation(userId: string, fromAgentId: string, toAgentId: string): boolean {
    if (this.delegationScope(userId, fromAgentId) === "agent") return true;
    return this.delegationScope(userId, toAgentId) !== undefined;
  }

  clearSessionAllow(userId: string, agentId: string): void {
    if (this.userDataRoot) {
      clearSessionCommandAllow(this.userDataRoot, userId, agentId);
      clearSessionToolAllow(this.userDataRoot, userId, agentId);
      clearSessionPathMountAllow(this.userDataRoot, userId, agentId);
      // 任一 Visit 新对话：清掉对本会话有效的会诊授权。
      clearSessionDelegationAllow(this.userDataRoot, userId);
      return;
    }
    const key = visitKey(userId, agentId);
    if (this.memoryAllow.get(key) === "session") this.memoryAllow.delete(key);
    if (this.memoryPathMountAllow.get(key) === "session") this.memoryPathMountAllow.delete(key);
    const toolPrefix = `${userId}/${agentId}/`;
    for (const [entry, scope] of [...this.memoryToolAllow.entries()]) {
      if (entry.startsWith(toolPrefix) && scope === "session") {
        this.memoryToolAllow.delete(entry);
      }
    }
    for (const [entry, scope] of [...this.memoryDelegationAllow.entries()]) {
      if (entry.startsWith(`${userId}/`) && scope === "session") {
        this.memoryDelegationAllow.delete(entry);
      }
    }
  }

  clearDelegationSessionAllow(userId: string, toAgentId: string): void {
    if (this.userDataRoot) {
      clearSessionDelegationAllowForTarget(this.userDataRoot, userId, toAgentId);
      return;
    }
    const key = delegationKey(userId, toAgentId);
    if (this.memoryDelegationAllow.get(key) === "session") {
      this.memoryDelegationAllow.delete(key);
    }
  }

  subscribe(listener: (request: ApprovalRequest) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persistUser(userId: string): void {
    if (!this.userDataRoot || !userId) return;
    const approvals = [
      ...[...this.pending.values()].map((entry) => entry.request).filter((item) => item.userId === userId),
      ...[...this.orphans.values()].filter((item) => item.userId === userId),
    ];
    writeHitlApprovals(this.userDataRoot, userId, approvals);
  }

  private applyGrant(
    request: Pick<ApprovalRequest, "userId" | "agentId" | "toolName" | "args">,
    scope: ApprovalScope,
  ): void {
    if (scope !== "session" && scope !== "agent") return;
    if (isProjectMountArgs(request.args)) {
      this.grantPathMount(request.userId, request.agentId, scope);
      return;
    }
    if (isCommandTool(request.toolName)) {
      this.grant(request.userId, request.agentId, scope);
      return;
    }
    if (isDelegationTool(request.toolName)) {
      this.applyDelegationGrant(request, scope);
      return;
    }
    if (isMcpTool(request.toolName)) {
      this.grantTool(request.userId, request.agentId, request.toolName, scope);
    }
  }

  /** 允许越界访问时：把提议目录写入 project_roots（once 也会挂载）。 */
  private applyProjectMount(
    request: Pick<ApprovalRequest, "userId" | "agentId" | "args">,
  ): void {
    if (!this.userDataRoot || !isProjectMountArgs(request.args)) return;
    const mountPath = request.args.mount_path;
    const visitRoot = request.args.visit_root;
    const kind = request.args.visit_kind === "personal" ? "personal" : "agent";
    if (typeof mountPath !== "string" || typeof visitRoot !== "string") return;
    try {
      addProjectRoot(this.userDataRoot, visitRoot, kind, mountPath);
    } catch {
      // 校验失败则不挂载；随后 fs-guard 仍会拒绝，工具结果带错。
    }
  }

  private grantPathMount(userId: string, agentId: string, scope: "session" | "agent"): void {
    if (this.userDataRoot) {
      setPathMountAllow(this.userDataRoot, userId, agentId, scope);
      return;
    }
    const key = visitKey(userId, agentId);
    if (this.memoryPathMountAllow.get(key) === "agent" && scope === "session") return;
    this.memoryPathMountAllow.set(key, scope);
  }

  private grant(userId: string, agentId: string, scope: "session" | "agent"): void {
    if (this.userDataRoot) {
      setCommandAllow(this.userDataRoot, userId, agentId, scope);
      return;
    }
    const key = visitKey(userId, agentId);
    if (this.memoryAllow.get(key) === "agent" && scope === "session") return;
    this.memoryAllow.set(key, scope);
  }

  private grantTool(
    userId: string,
    agentId: string,
    toolName: string,
    scope: "session" | "agent",
  ): void {
    if (this.userDataRoot) {
      setToolAllow(this.userDataRoot, userId, agentId, toolName, scope);
      return;
    }
    const key = toolKey(userId, agentId, toolName);
    if (this.memoryToolAllow.get(key) === "agent" && scope === "session") return;
    this.memoryToolAllow.set(key, scope);
  }

  /**
   * session → key=toAgentId；agent → key=fromAgentId（该助手可调任何人）。
   */
  private applyDelegationGrant(
    request: Pick<ApprovalRequest, "userId" | "agentId" | "args">,
    scope: ApprovalScope,
  ): void {
    if (scope === "agent") {
      this.grantDelegation(request.userId, request.agentId, "agent");
      return;
    }
    if (scope !== "session") return;
    for (const toAgentId of targetAgentIds(request.args)) {
      this.grantDelegation(request.userId, toAgentId, "session");
    }
  }

  private grantDelegation(userId: string, agentId: string, scope: "session" | "agent"): void {
    if (this.userDataRoot) {
      setDelegationAllow(this.userDataRoot, userId, agentId, scope);
      return;
    }
    const key = delegationKey(userId, agentId);
    if (this.memoryDelegationAllow.get(key) === "agent" && scope === "session") return;
    this.memoryDelegationAllow.set(key, scope);
  }

  private commandScope(userId: string, agentId: string): "session" | "agent" | undefined {
    if (this.userDataRoot) return getCommandAllow(this.userDataRoot, userId, agentId);
    return this.memoryAllow.get(visitKey(userId, agentId));
  }

  private toolScope(
    userId: string,
    agentId: string,
    toolName: string,
  ): "session" | "agent" | undefined {
    if (this.userDataRoot) return getToolAllow(this.userDataRoot, userId, agentId, toolName);
    return this.memoryToolAllow.get(toolKey(userId, agentId, toolName));
  }

  private delegationScope(userId: string, agentId: string): "session" | "agent" | undefined {
    if (this.userDataRoot) return getDelegationAllow(this.userDataRoot, userId, agentId);
    return this.memoryDelegationAllow.get(delegationKey(userId, agentId));
  }

  private pathMountScope(userId: string, agentId: string): "session" | "agent" | undefined {
    if (this.userDataRoot) return getPathMountAllow(this.userDataRoot, userId, agentId);
    return this.memoryPathMountAllow.get(visitKey(userId, agentId));
  }
}
