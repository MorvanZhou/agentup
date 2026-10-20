import type { InjectionKey, Ref } from "vue";
import { inject, ref } from "vue";

/** 当前 Agent 线程是否在主区可见（v-show 选中）。 */
export const threadActiveKey = Symbol("threadActive") as InjectionKey<Ref<boolean>>;

export function injectThreadActive(): Ref<boolean> {
  return inject(threadActiveKey, ref(true));
}
