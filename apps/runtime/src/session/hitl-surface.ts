/**
 * 嵌套委托 HITL 的展示归属：
 * 子 agent 在父 turn 仍 busy（同步 wait）时，审批/问卷应挂在父会话，
 * 与 turn 流 `isNestedUnder` 冒泡一致，避免子会话也亮 dock。
 * 异步委托（父已空闲）则仍挂在真实发起方，便于用户去子会话处理。
 */
export function surfaceHitlAgentId(
  originAgentId: string,
  options: {
    nestingParentId?: string;
    busyAgentIds: readonly string[];
  },
): string {
  const parentId = options.nestingParentId?.trim();
  if (!parentId) return originAgentId;
  if (!options.busyAgentIds.includes(parentId)) return originAgentId;
  return parentId;
}
