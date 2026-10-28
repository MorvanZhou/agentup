import type { ComputedRef, InjectionKey } from "vue";

/** 磁盘上还有更早的记录时，线程向上翻页去取，而不是只揭开已经在内存里的窗口。 */
export type ThreadEarlier = {
  hasMore: boolean;
  /** 把更早的一页接到现有记录前面，返回新接上的条数。一对一重挂线程时返回 0。 */
  loadOlder: () => Promise<number>;
};

export const threadEarlierKey: InjectionKey<ComputedRef<ThreadEarlier>> = Symbol("threadEarlier");

/** 一对一重挂时，本次要先露出的更早条数。只在挂载时读一次。 */
export const threadRevealEarlierKey: InjectionKey<ComputedRef<number>> = Symbol("threadRevealEarlier");

export const threadRevealConsumedKey: InjectionKey<() => void> = Symbol("threadRevealConsumed");
