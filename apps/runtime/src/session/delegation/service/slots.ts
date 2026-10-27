import { MAX_DELEGATION_CONCURRENT } from "../types.js";

/** 每用户委托并发闸门（排队 + abort 可取消等待）。 */
export class DelegationSlots {
  private readonly active = new Map<string, number>();
  private readonly waiters = new Map<string, Array<() => void>>();

  async acquire(userId: string, signal?: AbortSignal): Promise<void> {
    const current = this.active.get(userId) ?? 0;
    if (current < MAX_DELEGATION_CONCURRENT) {
      this.active.set(userId, current + 1);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const queue = this.waiters.get(userId) ?? [];
      const resume = () => {
        signal?.removeEventListener("abort", onAbort);
        const next = this.active.get(userId) ?? 0;
        this.active.set(userId, next + 1);
        resolve();
      };
      const onAbort = () => {
        const list = this.waiters.get(userId);
        if (list) {
          const index = list.indexOf(resume);
          if (index >= 0) list.splice(index, 1);
        }
        reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
      };
      queue.push(resume);
      this.waiters.set(userId, queue);
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  release(userId: string): void {
    const current = this.active.get(userId) ?? 0;
    const next = Math.max(0, current - 1);
    if (next === 0) this.active.delete(userId);
    else this.active.set(userId, next);
    const queue = this.waiters.get(userId);
    const resume = queue?.shift();
    if (queue && queue.length === 0) this.waiters.delete(userId);
    resume?.();
  }
}
