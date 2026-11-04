/**
 * 助手「重新生成」只应对最新一条 assistant：
 * 往前重试会 rewind 后续历史，不适合操作。
 */
export function isLatestAssistantMessage(
  messages: ReadonlyArray<{ id: string; role: string }>,
  messageId: string,
): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    return message.id === messageId;
  }
  return false;
}

/**
 * 是否渲染重新生成：须是最新助手，且本轮未在跑。
 * wake 旁路直播时「最新」在旁路气泡里，主线程历史条一律不显示。
 */
export function shouldShowAssistantReload(input: {
  canReload: boolean;
  messageId: string;
  messages: ReadonlyArray<{ id: string; role: string }>;
  threadRunning: boolean;
  messageRunning: boolean;
  wakeLiveActive: boolean;
}): boolean {
  if (!input.canReload) return false;
  if (input.threadRunning || input.messageRunning || input.wakeLiveActive) return false;
  return isLatestAssistantMessage(input.messages, input.messageId);
}
