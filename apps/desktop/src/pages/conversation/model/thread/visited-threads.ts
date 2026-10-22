/** 已打开过的会话线程：切走用 v-show 隐藏，不销毁 AISDKChat，流式可继续。 */
export function rememberVisited(visited: readonly string[], agentId: string): string[] {
  if (!agentId || visited.includes(agentId)) return [...visited];
  return [...visited, agentId];
}

/** 解雇或列表变化时丢掉已卸载的线程键。 */
export function pruneVisited(visited: readonly string[], agentIds: ReadonlySet<string>): string[] {
  return visited.filter((id) => agentIds.has(id));
}

export type MountedThread = {
  agentId: string;
  epoch: number;
};

export function mountedThreads(
  visited: readonly string[],
  loadEpoch: Readonly<Record<string, number>>,
): MountedThread[] {
  return visited.map((agentId) => ({
    agentId,
    epoch: loadEpoch[agentId] ?? 0,
  }));
}
