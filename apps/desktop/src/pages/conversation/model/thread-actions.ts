import type { ComputedRef, InjectionKey, Ref } from "vue";
import { inject } from "vue";

export interface ThreadActions {
  clearContext: () => Promise<void>;
  clearHistory: () => Promise<void>;
  clearing: boolean;
  clearingHistory: boolean;
  setRemark: (remark: string) => Promise<void>;
  dismiss: () => Promise<void>;
  /**
   * 停止本轮：收起 HITL 浮层，并等到 runtime busy 解开。
   * Composer 会先 cancelRun，再 await 本方法。
   */
  stopTurn: () => Promise<void>;
}

export const threadActionsKey = Symbol("threadActions") as InjectionKey<
  Ref<ThreadActions> | ComputedRef<ThreadActions>
>;

export function injectThreadActions(): Ref<ThreadActions> | ComputedRef<ThreadActions> | undefined {
  return inject(threadActionsKey);
}
