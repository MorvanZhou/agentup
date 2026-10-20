import type { UIMessageChunk } from "ai";

export type DelegationStartedEvent = {
  taskId: string;
  userId: string;
  fromAgentId: string;
  toAgentId: string;
  toAgentName: string;
  brief: string;
  toolCallId?: string;
  wait: boolean;
};

type ChunkListener = (chunk: UIMessageChunk) => void;
type StartedListener = (event: DelegationStartedEvent) => void;

type StreamSlot = {
  chunks: UIMessageChunk[];
  listeners: Set<ChunkListener>;
  /** finish() 已调用；晚订阅者只回放缓冲。 */
  closed: boolean;
  /** 关闭后仍保留缓冲一段时间，便于弹窗晚开。 */
  retainUntil: number;
};

const RETAIN_MS = 5 * 60_000;

/**
 * 委托子会话旁路进度：不进父消息，仅供弹窗订阅。
 * 每个 taskId 一份缓冲；晚订阅先回放再接 live。
 */
export class DelegationProgressHub {
  private readonly streams = new Map<string, StreamSlot>();
  private readonly startedListeners = new Set<StartedListener>();

  emitStarted(event: DelegationStartedEvent): void {
    this.ensure(event.taskId);
    for (const listener of this.startedListeners) {
      try {
        listener(event);
      } catch {
        // 旁路通知失败不影响委托执行
      }
    }
  }

  subscribeStarted(listener: StartedListener): () => void {
    this.startedListeners.add(listener);
    return () => {
      this.startedListeners.delete(listener);
    };
  }

  write(taskId: string, chunks: readonly UIMessageChunk[]): void {
    if (chunks.length === 0) return;
    const slot = this.ensure(taskId);
    if (slot.closed) return;
    slot.chunks.push(...chunks);
    for (const listener of slot.listeners) {
      for (const chunk of chunks) {
        try {
          listener(chunk);
        } catch {
          // 忽略单个订阅者错误
        }
      }
    }
  }

  finish(taskId: string): void {
    const slot = this.streams.get(taskId);
    if (!slot) return;
    slot.closed = true;
    slot.retainUntil = Date.now() + RETAIN_MS;
    // 通知监听者：无更多 chunk；由调用方在 write 里已含 projector.finish()
    slot.listeners.clear();
    this.prune();
  }

  isOpen(taskId: string): boolean {
    const slot = this.streams.get(taskId);
    return Boolean(slot && !slot.closed);
  }

  hasBuffer(taskId: string): boolean {
    this.prune();
    return (this.streams.get(taskId)?.chunks.length ?? 0) > 0;
  }

  /**
   * 订阅进度。若已有缓冲则先同步回放；若已关闭则只回放并立即结束。
   * @returns unsubscribe；关闭时自动清 listener。
   */
  subscribe(
    taskId: string,
    listener: ChunkListener,
  ): { unsubscribe: () => void; closed: boolean } {
    this.prune();
    const slot = this.ensure(taskId);
    for (const chunk of slot.chunks) listener(chunk);
    if (slot.closed) {
      return { unsubscribe: () => undefined, closed: true };
    }
    slot.listeners.add(listener);
    return {
      unsubscribe: () => {
        slot.listeners.delete(listener);
      },
      closed: false,
    };
  }

  /** 等待该 task 关闭（或已关闭）。 */
  waitUntilClosed(taskId: string, signal?: AbortSignal): Promise<void> {
    const slot = this.streams.get(taskId);
    if (!slot || slot.closed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new Error("aborted"));
        return;
      }
      const onAbort = () => {
        cleanup();
        reject(signal?.reason ?? new Error("aborted"));
      };
      const check = () => {
        if (slot.closed) {
          cleanup();
          resolve();
        }
      };
      const timer = setInterval(check, 50);
      signal?.addEventListener("abort", onAbort, { once: true });
      const cleanup = () => {
        clearInterval(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      // 也挂一个空 listener，finish 清 listeners 时靠轮询即可
      check();
    });
  }

  private ensure(taskId: string): StreamSlot {
    this.prune();
    let slot = this.streams.get(taskId);
    if (!slot) {
      slot = {
        chunks: [],
        listeners: new Set(),
        closed: false,
        retainUntil: 0,
      };
      this.streams.set(taskId, slot);
    }
    return slot;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, slot] of this.streams) {
      if (slot.closed && slot.retainUntil > 0 && slot.retainUntil <= now) {
        this.streams.delete(id);
      }
    }
  }
}
