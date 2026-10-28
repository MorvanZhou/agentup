import type { CreateAgentSessionResult } from "@earendil-works/pi-coding-agent";

import type { ModelConfig } from "../config/load.js";
import type { Visit } from "../package/sync.js";
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
    groupRosterPrompt = formatGroupRosterPrompt({
      selfAgentId: visit.agentId,
      members,
      cards,
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
