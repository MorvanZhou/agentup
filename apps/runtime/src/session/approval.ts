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
  private readonly listeners = new Set<(request: ApprovalRequest) => void>();
  /** 无持久化目录时的进程内回退（单测用）。 */
  private readonly memoryAllow = new Map<string, "session" | "agent">();
  private readonly memoryDelegationAllow = new Map<string, "session" | "agent">();

  constructor(private readonly userDataRoot?: string) {}

  request(request: Omit<ApprovalRequest, "id">, signal?: AbortSignal): Promise<boolean | undefined> {
    const value = { ...request, id: randomUUID() };
    return new Promise((resolve) => {
      const abort = () => {
        this.pending.delete(value.id);
        resolve(undefined);
      };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        resolve(undefined);
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(value.id, { request: value, resolve, cleanup });
      for (const listener of this.listeners) listener(value);
    });
  }

  decide(id: string, allowed: boolean, scope: ApprovalScope = "once"): boolean {
    const pending = this.pending.get(id);
    if (!pending) return false;
    this.pending.delete(id);
    pending.cleanup();
    if (allowed && isCommandTool(pending.request.toolName) && (scope === "session" || scope === "agent")) {
      this.grant(pending.request.userId, pending.request.agentId, scope);
    }
    if (
      allowed &&
      isDelegationTool(pending.request.toolName) &&
      (scope === "session" || scope === "agent")
    ) {
      const toAgentId = targetAgentId(pending.request.args);
      if (toAgentId) {
        this.grantDelegation(pending.request.userId, toAgentId, scope);
      }
    }
    pending.resolve(allowed);
    return true;
  }

  allowsCommand(userId: string, agentId: string): boolean {
    return this.commandScope(userId, agentId) !== undefined;
  }

  allowsDelegation(userId: string, toAgentId: string): boolean {
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

  private grant(userId: string, agentId: string, scope: "session" | "agent"): void {
    if (this.userDataRoot) {
      setCommandAllow(this.userDataRoot, userId, agentId, scope);
      return;
    }
    const key = visitKey(userId, agentId);
    if (this.memoryAllow.get(key) === "agent" && scope === "session") return;
    this.memoryAllow.set(key, scope);
  }

  private grantDelegation(userId: string, toAgentId: string, scope: "session" | "agent"): void {
    if (this.userDataRoot) {
      setDelegationAllow(this.userDataRoot, userId, toAgentId, scope);
      return;
    }
    const key = delegationKey(userId, toAgentId);
    if (this.memoryDelegationAllow.get(key) === "agent" && scope === "session") return;
    this.memoryDelegationAllow.set(key, scope);
  }

  private commandScope(userId: string, agentId: string): "session" | "agent" | undefined {
    if (this.userDataRoot) return getCommandAllow(this.userDataRoot, userId, agentId);
    return this.memoryAllow.get(visitKey(userId, agentId));
  }

  private delegationScope(userId: string, toAgentId: string): "session" | "agent" | undefined {
    if (this.userDataRoot) return getDelegationAllow(this.userDataRoot, userId, toAgentId);
    return this.memoryDelegationAllow.get(delegationKey(userId, toAgentId));
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
        if (toAgentId && broker.allowsDelegation(userId, toAgentId)) {
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
