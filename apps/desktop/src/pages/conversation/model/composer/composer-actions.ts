/** 一轮回复进行时，输入框露出哪些动作（停止 / 发送互斥，只留一个）。 */
export function composerRunActions(input: {
  /** 助手正在流式输出。有文字时发送会停下这一轮，并另起一条助手消息。 */
  streaming: boolean;
  /** 本轮仍可停止（含 AskUser / 审批 / wake）。 */
  stopVisible: boolean;
  hasText: boolean;
  inputDisabled: boolean;
  /** AskUser / 审批 / wake：只停止，不另起一条。 */
  steerBlocked: boolean;
  /** 子任务还在跑，但执掌者这句已经说完：空框停止，有字发送（与单聊一致）。 */
  tasksBusy?: boolean;
}): { stop: boolean; send: boolean; interrupt: boolean } {
  const interrupt =
    input.streaming && input.hasText && !input.inputDisabled && !input.steerBlocked;
  const tasksBusy =
    input.tasksBusy === true && !input.streaming && !input.steerBlocked && !interrupt;
  // 群子任务忙碌：与流式中同一套互斥——空→停，有字→发。
  if (tasksBusy) {
    const canSend = input.hasText && !input.inputDisabled;
    return { stop: !canSend, send: canSend, interrupt: false };
  }
  return {
    stop: input.stopVisible && !interrupt,
    send: (!input.stopVisible || interrupt) && !input.steerBlocked,
    interrupt,
  };
}
