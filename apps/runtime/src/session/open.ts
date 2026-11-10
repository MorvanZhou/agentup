import type { CreateAgentSessionResult } from "@earendil-works/pi-coding-agent";

import type { ModelConfig } from "../config/load.js";
import { getProviderTemplate } from "../config/provider-templates.js";
import type { Visit } from "../package/sync.js";
import { delegationTools } from "./external/mcp/delegation-tools.js";
import { presentPreviewTools } from "./external/mcp/preview-tools.js";
import type { McpTool } from "./external/mcp/server.js";
import type { BackgroundJobs } from "./background/index.js";
import { openProfiledSession } from "./core/session-factory.js";
import type { ConversationRef } from "./core/conversation-ref.js";
import { formatGroupRosterPrompt } from "./delegation/collaboration-prompt.js";
import type { DelegationService } from "./delegation/index.js";
import { ApprovalBroker } from "./hitl/approval/index.js";
import type { ShellHangBroker } from "./hitl/shell-hang/index.js";
import {
  AskUserBroker,
  createBackgroundJobsExtension,
  createDelegateExtension,
  createDelegationInboxExtension,
} from "./tools/index.js";

export type OpenSessionOptions = {
  sessionDir?: string;
  conversation?: ConversationRef;
};

export async function openSession(
  visit: Visit,
  model: ModelConfig,
  approvals = new ApprovalBroker(),
  askUser = new AskUserBroker(),
  delegation?: DelegationService,
  backgroundJobs?: BackgroundJobs,
  shellHang?: ShellHangBroker,
  sessionDirOrOptions?: string | OpenSessionOptions,
): Promise<CreateAgentSessionResult> {
  const scope = typeof sessionDirOrOptions === "string" ? { sessionDir: sessionDirOrOptions } : sessionDirOrOptions ?? {};
  const conversation = scope.conversation;
  const kind = conversation?.kind === "group" ? "group-holder" : "interactive";
  let groupRosterPrompt: string | undefined;
  if (kind === "group-holder" && conversation?.kind === "group" && delegation) {
    const members = delegation.listGroupMembers(visit.userId, conversation.groupId) ?? [];
    let cards: Awaited<ReturnType<DelegationService["listRecruited"]>> = [];
    try {
      cards = await delegation.listRecruited(visit.userId);
    } catch {
      cards = [];
    }
    // SDK 花名册写 MCP 工具名，避免模型用裸 delegate_to_agent / 显示名委派
    const toolSurface =
      getProviderTemplate(model.templateId)?.kind === "agent-sdk" ? "external" : "pi";
    groupRosterPrompt = formatGroupRosterPrompt({
      selfAgentId: visit.agentId,
      members,
      cards,
      toolSurface,
    });
  }
  const { result } = await openProfiledSession({
    kind,
    visit,
    model,
    approvals,
    askUser,
    shellHang,
    conversation,
    sessionDir: scope.sessionDir,
    services: { delegation: Boolean(delegation), background: Boolean(backgroundJobs) },
    // 外部 agent：父会话 MCP 挂 present_preview + 委托协调；产物确认由 session-factory 按委托 profile 另挂。技能走方案 D。
    externalMcp: ({ cwd, groupId, workspaceRoot }) =>
      externalMcpTools({
        visit,
        cwd,
        workspaceRoot: workspaceRoot ?? cwd,
        delegation,
        groupId,
      }),
    ...(groupRosterPrompt ? { groupRosterPrompt } : {}),
    parentExtensions: ({ cwd, groupId }) => ({
      afterArtifacts: delegation
        ? [
            createDelegationInboxExtension({
              onAgentStart: () => {
                delegation.materializePendingArtifacts(visit.userId, visit.agentId, cwd);
              },
            }),
          ]
        : [],
      afterShell: [
        ...(delegation ? [createDelegateExtension(delegation, visit.userId, visit.agentId, { groupId })] : []),
        ...(backgroundJobs
          ? [createBackgroundJobsExtension(backgroundJobs, visit.userId, visit.agentId, cwd, { groupId })]
          : []),
      ],
      ...(delegation
        ? {
            listDeliverablesPending: () =>
              delegation.listUnpresentedDeliverables(visit.userId, visit.agentId),
            markDeliverablesPresented: (taskIds: readonly string[]) => {
              delegation.markDeliverablesPresented(taskIds);
            },
          }
        : {}),
      resolveDelegationLabel: delegation
        ? async (toAgentId) => {
            const agents = await delegation.listRecruited(visit.userId);
            const card = agents.find((item) => item.agentId === toAgentId);
            if (!card) return undefined;
            const label = (card.remark || card.name).trim();
            return label || undefined;
          }
        : undefined,
    }),
  });
  return result;
}

/**
 * 外部 agent 的 MCP 工具集：人侧 preview 登记 + 委托协调。
 * 技能改走方案 D：投影到厂商目录（如 `.codebuddy/skills`），由 SDK 自带工具读取；此处不再挂 skill_*。
 * 委托子会话不传 externalMcp → 不挂本表（围栏）。
 */
function externalMcpTools(input: {
  visit: Visit;
  /** 保留与开会话签名一致；技能投影不经 MCP。 */
  cwd: string;
  /** Recipe 写入根：群共享 workspace，否则 visit cwd。 */
  workspaceRoot: string;
  delegation?: DelegationService;
  groupId?: string;
}): McpTool[] {
  void input.cwd;
  const tools: McpTool[] = [...presentPreviewTools({ workspaceRoot: input.workspaceRoot })];
  if (!input.delegation) return tools;
  tools.push(
    ...delegationTools({
      service: input.delegation,
      userId: input.visit.userId,
      agentId: input.visit.agentId,
      ...(input.groupId ? { groupId: input.groupId } : {}),
    }),
  );
  return tools;
}
