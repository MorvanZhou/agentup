/**
 * 从全量后台作业抽出「侧栏应显示正在回复」的 agentId。
 * 异步委托不在这里：派出方与专家的在场感走 delegationPresence，避免父行空闲时仍转圈。
 * 同步 wait 委托同样不算。
 */
export function asyncWorkingAgentIds(input: {
  delegations?: ReadonlyArray<{
    fromAgentId?: string;
    toAgentId?: string;
    wait?: boolean;
    status?: string;
  }>;
  backgroundJobs?: ReadonlyArray<{
    agentId?: string;
    status?: string;
  }>;
}): string[] {
  const ids = new Set<string>();
  for (const job of input.backgroundJobs ?? []) {
    if (job.status != null && job.status !== "running") continue;
    const id = job.agentId?.trim();
    if (id) ids.add(id);
  }
  return [...ids];
}
