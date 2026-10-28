import type { ExtensionFactory, ToolCallEvent } from "@earendil-works/pi-coding-agent";

import { hitlScopeFields } from "../origin.js";
import type { ApprovalBroker } from "./broker.js";
import { handleProjectMountGate } from "./project-mount.js";
import {
  isCommandTool,
  isDelegationTool,
  isFilePathTool,
  isMcpTool,
  requiresApproval,
  targetAgentIds,
} from "./tools.js";
import type { ApprovalExtensionOptions } from "./types.js";

export function createApprovalExtension(
  broker: ApprovalBroker,
  userId: string,
  agentId: string,
  options: ApprovalExtensionOptions = {},
): ExtensionFactory {
  const hitl = options.hitl ?? {};
  const scope = hitlScopeFields(hitl);
  return (pi) => {
    pi.on("tool_call", async (event: ToolCallEvent, context) => {
      if (isFilePathTool(event.toolName) && options.projectMount) {
        const mountResult = await handleProjectMountGate(
          broker,
          userId,
          agentId,
          event,
          context.cwd || options.projectMount.cwd,
          options.projectMount,
          scope.origin,
          hitl,
          context.signal,
        );
        if (mountResult !== "continue") return mountResult;
      }

      if (!requiresApproval(event.toolName)) return undefined;
      if (isCommandTool(event.toolName) && broker.allowsCommand(userId, agentId)) {
        return undefined;
      }
      if (isMcpTool(event.toolName) && broker.allowsTool(userId, agentId, event.toolName)) {
        return undefined;
      }
      if (isDelegationTool(event.toolName)) {
        const targets = targetAgentIds(event.input);
        if (
          targets.length > 0 &&
          targets.every((toAgentId) => broker.allowsDelegation(userId, agentId, toAgentId))
        ) {
          return undefined;
        }
      }
      const args = await enrichApprovalArgs(event.toolName, event.input, options);
      const allowed = await broker.request(
        {
          userId,
          agentId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args,
          ...scope,
        },
        context.signal,
      );
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
  const targets = targetAgentIds(input);
  if (targets.length === 0) return input;
  try {
    const labels: string[] = [];
    for (const toAgentId of targets) {
      const label = await options.resolveDelegationLabel(toAgentId);
      labels.push((label ?? toAgentId).trim() || toAgentId);
    }
    if (labels.length === 1) {
      return { ...input, agent_name: labels[0] };
    }
    return {
      ...input,
      agent_name: labels.join("、"),
      agent_names: labels,
      fanout_count: labels.length,
    };
  } catch {
    return input;
  }
}
