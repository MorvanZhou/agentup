import {
  ASYNC_WAKE_CUSTOM_TYPE,
  ASYNC_WAKE_SUCCESS_DEBOUNCE_MS,
  type AsyncWakeItem,
} from "./types.js";

export type AsyncWakeRunner = (input: {
  userId: string;
  agentId: string;
  kind: AsyncWakeItem["kind"];
  content: string;
  details: { items: unknown[] };
}) => Promise<void>;

type QueueState = {
  items: AsyncWakeItem[];
  timer?: ReturnType<typeof setTimeout>;
  draining: boolean;
};

/**
 * 异步完成 → 排队 → 父会话空闲时主动 wake（triggerTurn）。
 * 成功 debounce 合并；失败/取消立即 drain。
 * 用户若先发言：VisitChats 用 takePending + nextTurn 并进该轮，避免抢跑。
 */
export class AsyncWakeBroker {
  private readonly queues = new Map<string, QueueState>();
  /** 已入队或正在投递，避免 list/ack 重复 enqueue。 */
  private readonly inflight = new Set<string>();

  constructor(
    private readonly runWake: AsyncWakeRunner,
    private readonly isBusy: (
      userId: string,
      agentId: string,
      kind: AsyncWakeItem["kind"],
    ) => boolean,
    private readonly debounceMs = ASYNC_WAKE_SUCCESS_DEBOUNCE_MS,
  ) {}

  enqueue(item: AsyncWakeItem): void {
    if (this.inflight.has(item.id)) return;
    this.inflight.add(item.id);
    const key = queueKey(item.userId, item.agentId, item.kind);
    const state = this.queues.get(key) ?? { items: [], draining: false };
    this.queues.set(key, state);
    state.items.push(item);
    if (item.urgency === "immediate") {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = undefined;
      }
      void this.drain(key);
      return;
    }
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = undefined;
      void this.drain(key);
    }, this.debounceMs);
  }

  /**
   * 用户即将发言：取出排队项并入本轮（不再空闲 wake）。
   * 调用方负责 nextTurn 注入与 markDelivered。
   */
  takePending(
    userId: string,
    agentId: string,
    kind: AsyncWakeItem["kind"],
  ): AsyncWakeItem[] {
    const key = queueKey(userId, agentId, kind);
    const state = this.queues.get(key);
    if (!state || state.items.length === 0) return [];
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    const batch = state.items.splice(0, state.items.length);
    this.queues.delete(key);
    for (const item of batch) this.inflight.delete(item.id);
    return batch;
  }

  requeue(items: readonly AsyncWakeItem[]): void {
    for (const item of items) {
      if (this.inflight.has(item.id)) continue;
      this.inflight.add(item.id);
      const key = queueKey(item.userId, item.agentId, item.kind);
      const state = this.queues.get(key) ?? { items: [], draining: false };
      this.queues.set(key, state);
      state.items.push(item);
    }
  }

  /** 用户 turn 结束：若仍有排队则主动 wake。 */
  onParentIdle(userId: string, agentId: string, kind: AsyncWakeItem["kind"]): void {
    void this.drain(queueKey(userId, agentId, kind));
  }

  private async drain(key: string): Promise<void> {
    const state = this.queues.get(key);
    if (!state || state.draining || state.items.length === 0) return;
    const sample = state.items[0]!;
    if (this.isBusy(sample.userId, sample.agentId, sample.kind)) return;

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    state.draining = true;
    const batch = state.items.splice(0, state.items.length);
    try {
      const content = formatWakeContent(batch);
      await this.runWake({
        userId: sample.userId,
        agentId: sample.agentId,
        kind: sample.kind,
        content,
        details: { items: batch.map((item) => item.details ?? { id: item.id }) },
      });
      for (const item of batch) {
        try {
          item.markDelivered();
        } catch {
          // 标记失败不回滚 turn
        }
        this.inflight.delete(item.id);
      }
    } catch {
      for (const item of batch) this.inflight.delete(item.id);
      state.items.unshift(...batch);
    } finally {
      state.draining = false;
      if (state.items.length === 0) {
        this.queues.delete(key);
      } else if (!this.isBusy(sample.userId, sample.agentId, sample.kind)) {
        void this.drain(key);
      }
    }
  }
}

export function formatWakeContent(items: readonly AsyncWakeItem[]): string {
  const blocks = items.map((item) => item.body.trim()).filter(Boolean);
  return (
    "【异步结果通知】下列后台工作已结束。请用自然语言向用户汇报要点，必要时继续行动；" +
    "不要原样倾倒日志或原始输出。此通知对用户不可见。\n\n" +
    blocks.join("\n\n---\n\n")
  );
}

export function queueKey(
  userId: string,
  agentId: string,
  kind: AsyncWakeItem["kind"],
): string {
  return `${userId}/${kind}/${agentId}`;
}

export { ASYNC_WAKE_CUSTOM_TYPE };
