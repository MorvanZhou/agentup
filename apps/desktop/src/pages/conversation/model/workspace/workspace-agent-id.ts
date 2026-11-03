/**
 * 工作区读写 / 预览用的 agentId：
 * 单聊用线程 inject；群聊消息树 inject 常为空，回落 `group:<groupId>`。
 */
export function resolveWorkspaceAgentId(input: {
  override?: string | null;
  injectedAgentId?: string | null;
  groupId?: string | null;
}): string {
  const override = input.override?.trim() ?? "";
  if (override) return override;
  const injected = input.injectedAgentId?.trim() ?? "";
  if (injected) return injected;
  const groupId = input.groupId?.trim() ?? "";
  return groupId ? `group:${groupId}` : "";
}
