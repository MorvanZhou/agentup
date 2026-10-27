import type { UIMessage } from "ai";

/** 最后一条 assistant 的 parts 数；无则 0。用于判断 SSE 回放是否已追上 history。 */
export function assistantPartCount(messages: readonly UIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "assistant") return message.parts?.length ?? 0;
  }
  return 0;
}

/**
 * SSE 晚订阅会从头回放缓冲。若已先展示 history，过早套用早期 snapshot
 * 会把时间线从「已有进度」瞬间缩回开头。
 * historyFloor=0（无历史）时照常应用。
 */
export function shouldApplyStreamMessage(
  streamMessage: UIMessage,
  historyFloor: number,
): boolean {
  if (historyFloor <= 0) return true;
  return (streamMessage.parts?.length ?? 0) >= historyFloor;
}
