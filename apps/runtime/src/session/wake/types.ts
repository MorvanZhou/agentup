/** 异步结果：空闲时主动 wake；若用户先发言则挂到该轮 nextTurn。 */
export const ASYNC_WAKE_CUSTOM_TYPE = "agentup.async_wake";

/** 成功结果短暂合并，减少连续打扰；失败/取消立即冲刷。 */
export const ASYNC_WAKE_SUCCESS_DEBOUNCE_MS = 400;

export type AsyncWakeUrgency = "batch" | "immediate";

export type AsyncWakeItem = {
  /** 去重键：delegation taskId / background jobId。 */
  id: string;
  userId: string;
  agentId: string;
  kind: "personal" | "recruited" | "local";
  urgency: AsyncWakeUrgency;
  /** 已格式化的单条结果正文（含标题）。 */
  body: string;
  details?: unknown;
  /** 成功投递给模型后调用（写 notified）。 */
  markDelivered: () => void;
};
