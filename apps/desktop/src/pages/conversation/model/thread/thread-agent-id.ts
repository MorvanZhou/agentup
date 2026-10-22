import type { InjectionKey, Ref } from "vue";
import { inject, unref } from "vue";

export const threadAgentIdKey = Symbol("threadAgentId") as InjectionKey<
  string | Ref<string>
>;

export function injectThreadAgentId(): string {
  return unref(inject(threadAgentIdKey, "")) || "";
}
