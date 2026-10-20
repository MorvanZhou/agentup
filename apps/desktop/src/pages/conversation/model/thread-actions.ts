import type { ComputedRef, InjectionKey, Ref } from "vue";
import { inject } from "vue";

export interface ThreadActions {
  clearContext: () => Promise<void>;
  clearHistory: () => Promise<void>;
  clearing: boolean;
  clearingHistory: boolean;
  setRemark: (remark: string) => Promise<void>;
  dismiss: () => Promise<void>;
  /** 停止本轮：收起 HITL 浮层并 cancelRun（AskUser 等待时 isRunning 可能已是 false）。 */
  stopTurn: () => void;
}

export const threadActionsKey = Symbol("threadActions") as InjectionKey<
  Ref<ThreadActions> | ComputedRef<ThreadActions>
>;

export function injectThreadActions(): Ref<ThreadActions> | ComputedRef<ThreadActions> | undefined {
  return inject(threadActionsKey);
}
