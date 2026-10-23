import { inject, type InjectionKey, type Ref } from "vue";
import type { UIMessage } from "ai";

export type ThreadWakeLive = {
  streaming: boolean;
  message: UIMessage | null;
};

export const threadWakeLiveKey: InjectionKey<Ref<ThreadWakeLive>> = Symbol("threadWakeLive");

export function injectThreadWakeLive(): Ref<ThreadWakeLive> | undefined {
  return inject(threadWakeLiveKey, undefined);
}
