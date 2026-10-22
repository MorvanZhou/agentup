import { randomUUID } from "node:crypto";

import type { ExtensionFactory, ToolCallEvent } from "@earendil-works/pi-coding-agent";

import {
  clearSessionCommandAllow,
  clearSessionDelegationAllow,
  clearSessionDelegationAllowForTarget,
  getCommandAllow,
  getDelegationAllow,
  setCommandAllow,
  setDelegationAllow,
} from "../local/state.js";
import { readHitlPending, writeHitlApprovals } from "./hitl-pending.js";
import { hasDanglingToolCall, repairOrphanApproval } from "./hitl-repair.js";

export type ApprovalScope = "once" | "session" | "agent";

export interface ApprovalRequest {
  id: string;
  userId: string;
  agentId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

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
      if (allowed && isCommandTool(pending.request.toolName) && (scope === "session" || scope === "agent")) {
        this.grant(pending.request.userId, pending.request.agentId, scope);
      }
      if (allowed && isDelegationTool(pending.request.toolName)) {
        this.applyDelegationGrant(pending.request, scope);
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
      if (isCommandTool(orphan.toolName) && (scope === "session" || scope === "agent")) {
        this.grant(orphan.userId, orphan.agentId, scope);
      }
      if (isDelegationTool(orphan.toolName)) {
        this.applyDelegationGrant(orphan, scope);
      }
    }
    this.persistUser(orphan.userId);
    // 修不上也清掉（A：不可闭合的不留假 blocked）；对 UI 仍算「已处理」。
    return true;
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
      // 任一 Visit 新对话：清掉对本会话有效的会诊授权。
      clearSessionDelegationAllow(this.userDataRoot, userId);
      return;
    }
    const key = visitKey(userId, agentId);
    if (this.memoryAllow.get(key) === "session") this.memoryAllow.delete(key);
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

  private grant(userId: string, agentId: string, scope: "session" | "agent"): void {
    if (this.userDataRoot) {
      setCommandAllow(this.userDataRoot, userId, agentId, scope);
      return;
    }
    const key = visitKey(userId, agentId);
    if (this.memoryAllow.get(key) === "agent" && scope === "session") return;
    this.memoryAllow.set(key, scope);
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
    const toAgentId = targetAgentId(request.args);
    if (toAgentId) this.grantDelegation(request.userId, toAgentId, "session");
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

  private delegationScope(userId: string, agentId: string): "session" | "agent" | undefined {
    if (this.userDataRoot) return getDelegationAllow(this.userDataRoot, userId, agentId);
    return this.memoryDelegationAllow.get(delegationKey(userId, agentId));
  }
}

export type ApprovalExtensionOptions = {
  /** 委托审批时解析专家展示名（备注名 / 名片名），写入 args.agent_name。 */
  resolveDelegationLabel?: (toAgentId: string) => Promise<string | undefined>;
};

export function createApprovalExtension(
  broker: ApprovalBroker,
  userId: string,
  agentId: string,
  options: ApprovalExtensionOptions = {},
): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event: ToolCallEvent, context) => {
      if (!requiresApproval(event.toolName)) return undefined;
      if (isCommandTool(event.toolName) && broker.allowsCommand(userId, agentId)) {
        return undefined;
      }
      if (isDelegationTool(event.toolName)) {
        const toAgentId = targetAgentId(event.input);
        if (toAgentId && broker.allowsDelegation(userId, agentId, toAgentId)) {
          return undefined;
        }
      }
      const args = await enrichApprovalArgs(event.toolName, event.input, options);
      const allowed = await broker.request({
        userId,
        agentId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args,
      }, context.signal);
      if (allowed === undefined) return undefined;
      return allowed ? undefined : { block: true, reason: "用户拒绝了这次工具调用" };
    });
  };
}

async function enrichApprovalArgs(
  toolName: string,
  input: Record<string, unknown>,
  options: ApprovalExtensionOptions,
): Promise<Record<string, unknown>> {
  if (!isDelegationTool(toolName) || !options.resolveDelegationLabel) return input;
  const toAgentId = targetAgentId(input);
  if (!toAgentId) return input;
  try {
    const label = await options.resolveDelegationLabel(toAgentId);
    if (!label) return input;
    return { ...input, agent_name: label };
  } catch {
    return input;
  }
}

function visitKey(userId: string, agentId: string): string {
  return `${userId}/${agentId}`;
}

function delegationKey(userId: string, toAgentId: string): string {
  return `${userId}/${toAgentId}`;
}

function isCommandTool(toolName: string): boolean {
  return toolName === "bash" || toolName === "powershell";
}

function isDelegationTool(toolName: string): boolean {
  return toolName === "delegate_to_agent";
}

function targetAgentId(args: Record<string, unknown>): string | undefined {
  const value = args.agent_id;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function requiresApproval(toolName: string): boolean {
  return (
    isCommandTool(toolName) ||
    isDelegationTool(toolName) ||
    toolName.startsWith("mcp__") ||
    toolName === "read_mcp_resource" ||
    toolName === "list_mcp_resources" ||
    toolName === "list_mcp_resource_templates"
  );
}
