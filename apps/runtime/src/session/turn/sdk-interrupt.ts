/**
 * SDK 无 Pi 原生 steer / nextTurn：Host 用「入队 + 打断本轮 external query + 续轮重拼」。
 * 群执掌 inject 与委托 steer 共用，禁止只 append session 却不打断正在跑的厂商 agent。
 */

/** 把 note 入队并打断当前 external 回合（勿动任务/用户级 cancel signal）。 */
export function createSdkInterruptQueue(input: {
  notes: string[];
  interrupt: () => void;
}): (note: string) => Promise<void> {
  return async (note) => {
    input.notes.push(note);
    input.interrupt();
  };
}

/** 用户取消 ∪ 本轮打断：合成 signal；dispose 卸掉监听。 */
export function linkTurnSignal(
  userSignal: AbortSignal | undefined,
  turnSignal: AbortSignal,
): AbortSignal & { dispose: () => void } {
  const gate = new AbortController();
  const abort = () => {
    if (!gate.signal.aborted) gate.abort();
  };
  if (userSignal?.aborted || turnSignal.aborted) abort();
  userSignal?.addEventListener("abort", abort);
  turnSignal.addEventListener("abort", abort);
  return Object.assign(gate.signal, {
    dispose: () => {
      userSignal?.removeEventListener("abort", abort);
      turnSignal.removeEventListener("abort", abort);
    },
  });
}
