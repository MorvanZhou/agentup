/** 云端成员只有 agentId；本机建壳时从已投影 / 本机 Agent 补显示名。 */

import { listDiskSyncedAgents } from "./agents/disk-synced.js";
import { listLocalAgents } from "./agents/local-agent.js";
import type { GroupMember } from "../session/group/types.js";

export function resolveGroupMembers(
  userDataRoot: string,
  userId: string,
  agentIds: readonly string[],
): GroupMember[] {
  const names = new Map<string, string>();
  for (const agent of listDiskSyncedAgents(userDataRoot, userId)) {
    const label = (agent.remark || agent.name).trim();
    if (label) names.set(agent.agentId, label);
  }
  for (const agent of listLocalAgents(userDataRoot, userId)) {
    const label = agent.name.trim();
    if (label) names.set(agent.agentId, label);
  }
  return agentIds.map((agentId) => {
    const id = agentId.trim();
    return { agentId: id, name: names.get(id) || id };
  });
}
