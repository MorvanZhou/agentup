/**
 * 过程折叠开合：仅当次会话内存缓存。
 * 离开再进入某 Agent 对话时清空，不落盘。
 */

const userOpen = new Map<string, boolean>();

function foldKey(agentId: string, messageId: string, groupId: string): string {
  return `${agentId}\0${messageId}\0${groupId}`;
}

/** 用户是否手动指定过该段开合；未指定返回 undefined。 */
export function getProcessFoldOverride(
  agentId: string,
  messageId: string,
  groupId: string,
): boolean | undefined {
  if (!agentId || !messageId || !groupId) return undefined;
  return userOpen.get(foldKey(agentId, messageId, groupId));
}

export function setProcessFoldOverride(
  agentId: string,
  messageId: string,
  groupId: string,
  open: boolean,
): void {
  if (!agentId || !messageId || !groupId) return;
  userOpen.set(foldKey(agentId, messageId, groupId), open);
}

/** 重新进入某 Agent 对话时清空其折叠记忆。 */
export function clearProcessFoldState(agentId: string): void {
  if (!agentId) {
    userOpen.clear();
    return;
  }
  const prefix = `${agentId}\0`;
  for (const key of userOpen.keys()) {
    if (key.startsWith(prefix)) userOpen.delete(key);
  }
}
