import type { ComputedRef, InjectionKey, Ref } from "vue";
import { computed, inject } from "vue";

import type { AgentUpAskUserData } from "../../../../shared/model/chat/chat";

export const threadAskUserKey = Symbol("threadAskUser") as InjectionKey<
  Ref<AgentUpAskUserData | undefined> | ComputedRef<AgentUpAskUserData | undefined>
>;

export function injectThreadAskUser():
  | Ref<AgentUpAskUserData | undefined>
  | ComputedRef<AgentUpAskUserData | undefined>
  | undefined {
  return inject(threadAskUserKey, undefined);
}

/** 当前线程待回答 ask_user 的 toolCallId；无提问时为 undefined。 */
export function injectPendingAskUserToolCallId(): ComputedRef<string | undefined> {
  const value = inject(threadAskUserKey, undefined);
  return computed(() => value?.value?.toolCallId);
}
