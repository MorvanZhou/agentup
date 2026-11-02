import { inject, type InjectionKey, type Ref } from "vue";
import type { UIMessage } from "ai";

export type ThreadWakeLive = {
  streaming: boolean;
  message: UIMessage | null;
  /** followUp 队列被消费时先亮出来的用户那条（拼接后的整串）；空则不占位置。 */
  userText: string;
};

export const threadWakeLiveKey: InjectionKey<Ref<ThreadWakeLive>> = Symbol("threadWakeLive");

export function injectThreadWakeLive(): Ref<ThreadWakeLive> | undefined {
  return inject(threadWakeLiveKey, undefined);
}
