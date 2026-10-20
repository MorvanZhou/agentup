/** 本轮停止后是否应收起 AskUser / 审批浮层。 */

export type ThreadStopStatus = {
  type?: string;
  reason?: string;
} | null | undefined;

/**
 * isRunning 从 true→false 时调用。
 * 仅在 assistant 消息被标为 incomplete/cancelled（用户点「停止」）时收起；
 * 流正常结束但仍挂着 HITL（测试 mock / 极端时序）时不收起，避免误关问卷。
 */
export function shouldDismissHitlOnStop(
  wasRunning: boolean,
  running: boolean,
  lastAssistantStatus?: ThreadStopStatus,
): boolean {
  if (!wasRunning || running) return false;
  if (lastAssistantStatus?.type === "incomplete") return true;
  return lastAssistantStatus?.reason === "cancelled";
}
