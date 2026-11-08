import type { ComputedRef, InjectionKey, Ref } from "vue";
import { computed, inject } from "vue";

import type { AgentUpDelegationStartedData } from "../../../../shared/model/chat/chat";
import type { AgentUpReplyModel } from "../message/message-reply-model";

/** 打开委托过程弹窗所需的最小信息。 */
export type DelegationProcessTarget = {
  taskId: string;
  toAgentId: string;
  toAgentName: string;
  brief: string;
  toolCallId?: string;
  /** 协助方头像；无则 Dialog 用首字占位。 */
  toAgentAvatarUrl?: string;
};

export type ThreadDelegationApi = {
  /** 由 transient started 事件登记 toolCallId → taskId / 模型。 */
  registerStarted: (data: AgentUpDelegationStartedData) => void;
  /** 进行中优先用 toolCallId 反查；也可直接给 taskId。 */
  resolveTaskId: (toolCallId: string) => string | undefined;
  /** 进行中用 toolCallId 或 taskId 反查派出时的模型快照。 */
  resolveReplyModel: (toolCallIdOrTaskId: string) => AgentUpReplyModel | undefined;
  openProcess: (target: DelegationProcessTarget) => void;
};

export const threadDelegationKey = Symbol("threadDelegation") as InjectionKey<
  Ref<ThreadDelegationApi> | ComputedRef<ThreadDelegationApi>
>;

const noop: ThreadDelegationApi = {
  registerStarted: () => undefined,
  resolveTaskId: () => undefined,
  resolveReplyModel: () => undefined,
  openProcess: () => undefined,
};

export function injectThreadDelegation(): ComputedRef<ThreadDelegationApi> {
  const value = inject(threadDelegationKey);
  return computed(() => value?.value ?? noop);
}
