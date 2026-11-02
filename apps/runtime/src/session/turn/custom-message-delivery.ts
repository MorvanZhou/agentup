/**
 * Pi 原生：custom message 用 `deliverAs: "nextTurn"`，等下次 `prompt()` 才并进模型上下文。
 * SDK / `externalQuery`：不走 Pi `prompt()`，nextTurn 队列永不 flush —— 必须立即 append 到分支。
 */
export function customMessageDelivery(session: {
  externalQuery?: unknown;
}): { deliverAs: "nextTurn" } | Record<string, never> {
  if (session.externalQuery) return {};
  return { deliverAs: "nextTurn" };
}
