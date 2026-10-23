import type { UIMessageChunk } from "ai";

type ChunkListener = (chunk: UIMessageChunk) => void;

type StreamSlot = {
  chunks: UIMessageChunk[];
  listeners: Set<ChunkListener>;
  closed: boolean;
  retainUntil: number;
};

const RETAIN_MS = 5 * 60_000;

/**
 * 主会话 turn 旁路 UIMessage 流（wake / 未来其它无 prompt 客户端的回合）。
 * 键：`${userId}/${agentId}`；晚订阅先回放缓冲。
 */
export class TurnStreamHub {
  private readonly streams = new Map<string, StreamSlot>();

  static key(userId: string, agentId: string): string {
    return `${userId}/${agentId}`;
  }

  /** 回合开始：打开槽位，供桌面在首个 chunk 前就连上。 */
  begin(key: string): void {
    const slot = this.ensure(key);
    slot.closed = false;
    slot.retainUntil = 0;
  }

  write(key: string, chunks: readonly UIMessageChunk[]): void {
    if (chunks.length === 0) return;
    const slot = this.ensure(key);
    if (slot.closed) return;
    slot.chunks.push(...chunks);
    for (const listener of slot.listeners) {
      for (const chunk of chunks) {
        try {
          listener(chunk);
        } catch {
          // 单个订阅者失败不影响回合
        }
      }
    }
  }

  finish(key: string): void {
    const slot = this.streams.get(key);
    if (!slot) return;
    slot.closed = true;
    slot.retainUntil = Date.now() + RETAIN_MS;
    slot.listeners.clear();
    this.prune();
  }

  isOpen(key: string): boolean {
    const slot = this.streams.get(key);
    return Boolean(slot && !slot.closed);
  }

  hasBuffer(key: string): boolean {
    this.prune();
    return (this.streams.get(key)?.chunks.length ?? 0) > 0;
  }

  subscribe(
    key: string,
    listener: ChunkListener,
  ): { unsubscribe: () => void; closed: boolean } {
    this.prune();
    const slot = this.ensure(key);
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

  private ensure(key: string): StreamSlot {
    this.prune();
    let slot = this.streams.get(key);
    if (!slot) {
      slot = {
        chunks: [],
        listeners: new Set(),
        closed: false,
        retainUntil: 0,
      };
      this.streams.set(key, slot);
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
