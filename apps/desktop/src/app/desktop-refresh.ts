import type { AgentCard, PersonalAssistantProfile } from "../shared/model/runtime/runtime";

/** 以 preferred 为主，把 extras 里未见过的 id 接在后面。 */
export function mergeAgentLists(preferred: AgentCard[], extras: AgentCard[]): AgentCard[] {
  const seen = new Set(preferred.map((agent) => agent.agentId));
  return [...preferred, ...extras.filter((agent) => !seen.has(agent.agentId))];
}

/**
 * 本地阶段侧栏快照：本机 Agent + 磁盘已投影招募；
 * 再保留上一帧仍在的招募，避免二次 refresh 中段把已招募闪掉。
 */
export function localFirstAgentSnapshot(
  local: AgentCard[],
  projected: AgentCard[],
  previous: AgentCard[],
): AgentCard[] {
  const withProjected = mergeAgentLists(local, projected);
  const kept = previous.filter(
    (agent) => agent.recruited && agent.kind !== "local" && agent.kind !== "personal",
  );
  return mergeAgentLists(withProjected, kept);
}

export type DesktopAgentRefreshIo = {
  /** 账号头像续签：不阻塞侧栏本地提交。 */
  hydrateAccountAvatar?: () => Promise<void>;
  loadPersonalAssistant: () => Promise<PersonalAssistantProfile | null>;
  loadLocalAgents: () => Promise<AgentCard[]>;
  /** 本机已投影招募（不打控制面）。 */
  loadProjectedAgents: () => Promise<AgentCard[]>;
  loadRemoteAgents: () => Promise<AgentCard[]>;
  isStale: () => boolean;
  readPreviousAgents: () => AgentCard[];
  commitPersonalAssistant: (profile: PersonalAssistantProfile | null) => void;
  commitAgents: (agents: AgentCard[]) => void;
};

/**
 * 本地优先拉侧栏 Agent：先提交本机+磁盘投影，再拉远端对齐；头像续签并行不挡。
 * 远端失败时保留本地阶段，避免已招募被清空。
 */
export async function loadAgentsLocalFirst(io: DesktopAgentRefreshIo): Promise<AgentCard[]> {
  if (io.hydrateAccountAvatar) void io.hydrateAccountAvatar();

  const [personalAssistant, local, projected] = await Promise.all([
    io.loadPersonalAssistant().catch(() => null),
    io.loadLocalAgents().catch(() => [] as AgentCard[]),
    io.loadProjectedAgents().catch(() => [] as AgentCard[]),
  ]);
  if (io.isStale()) return io.readPreviousAgents();

  io.commitPersonalAssistant(personalAssistant);
  const early = localFirstAgentSnapshot(local, projected, io.readPreviousAgents());
  io.commitAgents(early);

  let remote: AgentCard[] | null = null;
  try {
    remote = await io.loadRemoteAgents();
  } catch {
    remote = null;
  }
  if (io.isStale()) return early;
  if (remote === null) return early;

  const merged = mergeAgentLists(local, remote);
  io.commitAgents(merged);
  return merged;
}
