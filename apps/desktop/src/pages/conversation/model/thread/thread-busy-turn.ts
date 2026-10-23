import { inject, type InjectionKey, type Ref } from "vue";

import type { BusyTurn } from "../../../../shared/api/runtime/chat";

/** 本会话 attention busy turn（wake 编排可见；Composer / 顶栏停转）。 */
export const threadBusyTurnKey: InjectionKey<Ref<BusyTurn | null | undefined>> =
  Symbol("threadBusyTurn");

export function injectThreadBusyTurn(): Ref<BusyTurn | null | undefined> | undefined {
  return inject(threadBusyTurnKey, undefined);
}
