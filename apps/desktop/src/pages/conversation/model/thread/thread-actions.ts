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
  /**
   * 把一条消息放进 runtime 的 followUp 队列（本地 Agent App 接入，docs/agent_cli §12.8）。
   * 会话级动作：需要 token / userId / agentId，Composer 拿不到，故由 AgentThread 提供。
   */
  enqueueFollowUp: (text: string) => Promise<void>;
  /**
   * 插话：API / Pi 原生接入走 runtime 的 Pi 原生 steer（保留已做的工作，docs/agent_cli §12.8）。
   * 返回 false 表示没插上（会话没在跑 / 外部 agent 接入），Composer 改走「停止后重发」。
   */
  steerTurn: (text: string) => Promise<boolean>;
}

export const threadActionsKey = Symbol("threadActions") as InjectionKey<
  Ref<ThreadActions> | ComputedRef<ThreadActions>
>;

export function injectThreadActions(): Ref<ThreadActions> | ComputedRef<ThreadActions> | undefined {
  return inject(threadActionsKey);
}
