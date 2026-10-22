import type { ComputedRef, InjectionKey, Ref } from "vue";
import { computed, inject } from "vue";

import type { AgentUpApprovalData } from "../../../../shared/model/chat";

export const threadApprovalKey = Symbol("threadApproval") as InjectionKey<
  Ref<AgentUpApprovalData | undefined> | ComputedRef<AgentUpApprovalData | undefined>
>;

export function injectThreadApproval():
  | Ref<AgentUpApprovalData | undefined>
  | ComputedRef<AgentUpApprovalData | undefined>
  | undefined {
  return inject(threadApprovalKey, undefined);
}

/** 当前线程待审批工具的 toolCallId；无审批时为 undefined。 */
export function injectPendingApprovalToolCallId(): ComputedRef<string | undefined> {
  const value = inject(threadApprovalKey, undefined);
  return computed(() => value?.value?.toolCallId);
}
