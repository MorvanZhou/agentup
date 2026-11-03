import { randomUUID } from "node:crypto";

/**
 * followUp 队列：本地 Agent App（SDK）接入下，回合进行中用户新发消息的落点。
 * 背景见 .cursor/skills/agentup-sdk-adapter/references/follow-up.md：SDK 没有原生 steer（只有 interrupt），
 * 所以这类接入固定用「排队，本轮结束后合并成一条再开一轮」，不再返回 409 ChatBusy。
 *
 * 纯数据结构：不碰会话、不发 HTTP，方便单测覆盖排序与上限。
 */

/** 队列上限：满了就拒绝入队，由 UI 提示（避免无限堆积）。 */
export const MAX_FOLLOW_UPS = 5;

/** 队列已满：调用方应提示用户，而不是静默丢弃。 */
export class FollowUpQueueFull extends Error {
  constructor() {
    super("follow_up_queue_full");
  }
}

export type FollowUpItem = {
  id: string;
  text: string;
  createdAt: number;
};

export type FollowUpQueueOptions = {
  /** 上限；群 / 委托可以给不同的值。 */
  max?: number;
  now?: () => number;
  id?: () => string;
};

export class FollowUpQueue {
  private readonly items: FollowUpItem[] = [];
  private readonly max: number;
  private readonly now: () => number;
  private readonly nextId: () => string;

  constructor(options: FollowUpQueueOptions = {}) {
    this.max = options.max ?? MAX_FOLLOW_UPS;
    this.now = options.now ?? (() => Date.now());
    this.nextId = options.id ?? (() => `fu-${randomUUID()}`);
  }

  get size(): number {
    return this.items.length;
  }

  get capacity(): number {
    return this.max;
  }

  /** 快照副本：外部改它不影响队列，UI 可以放心渲染。 */
  list(): FollowUpItem[] {
    return this.items.map((item) => ({ ...item }));
  }

  /** 入队。满则抛 FollowUpQueueFull，且不改动已有条目。 */
  enqueue(text: string): FollowUpItem {
    const content = text.trim();
    if (!content) throw new Error("follow_up_empty");
    if (this.items.length >= this.max) throw new FollowUpQueueFull();
    const item: FollowUpItem = { id: this.nextId(), text: content, createdAt: this.now() };
    this.items.push(item);
    return { ...item };
  }

  /** 编辑还没跑的条目（跑掉之后 id 已不存在，返回 null）。 */
  update(id: string, text: string): FollowUpItem | null {
    const content = text.trim();
    if (!content) throw new Error("follow_up_empty");
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const item = this.items[index]!;
    // 位置不动：改文案不该顺带改变执行顺序
    this.items[index] = { ...item, text: content };
    return { ...this.items[index]! };
  }

  remove(id: string): boolean {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  /** 插队 / 置顶：把该条挪到最前，其余保持原相对顺序。 */
  promote(id: string): boolean {
    const index = this.items.findIndex((item) => item.id === id);
    if (index <= 0) return index === 0;
    const [item] = this.items.splice(index, 1);
    this.items.unshift(item!);
    return true;
  }

  /** 取下一条并移出队列。 */
  shift(): FollowUpItem | undefined {
    const item = this.items.shift();
    return item ? { ...item } : undefined;
  }

  /**
   * 一次取空并按排队顺序返回（消费语义：整串拼成一条发一轮，见 §12.8.1）。
   * 取完队列即空，调用方不必再循环。
   */
  drainAll(): FollowUpItem[] {
    const taken = this.items.map((item) => ({ ...item }));
    this.items.length = 0;
    return taken;
  }

  /** 消费轮在起流/执行阶段失败时原序放回；期间新入队的内容排在它们后面。 */
  restoreFront(items: FollowUpItem[]): void {
    if (items.length === 0) return;
    const queuedIds = new Set(this.items.map((item) => item.id));
    const restored = items.filter((item) => !queuedIds.has(item.id)).map((item) => ({ ...item }));
    this.items.unshift(...restored);
  }

  /** 清空（用户放弃整串意图）；返回被丢弃条数。 */
  clear(): number {
    const count = this.items.length;
    this.items.length = 0;
    return count;
  }
}
