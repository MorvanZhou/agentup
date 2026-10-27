/** 一轮回复进行时，输入框露出哪些动作。 */
export function composerRunActions(input: {
  /** 助手正在流式输出。有文字时发送会停下这一轮，并另起一条助手消息。 */
  streaming: boolean;
  /** 本轮仍可停止（含 AskUser / 审批 / wake）。 */
  stopVisible: boolean;
  hasText: boolean;
  inputDisabled: boolean;
  /** AskUser / 审批 / wake：只停止，不另起一条。 */
  steerBlocked: boolean;
}): { stop: boolean; send: boolean; interrupt: boolean } {
  const interrupt =
    input.streaming && input.hasText && !input.inputDisabled && !input.steerBlocked;
  return {
    stop: input.stopVisible && !interrupt,
    send: !input.stopVisible || interrupt,
    interrupt,
  };
}
