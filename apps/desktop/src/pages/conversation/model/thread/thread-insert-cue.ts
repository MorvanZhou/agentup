import { inject, type InjectionKey, type Ref } from "vue";

/**
 * 群聊中途插入的定位线索（仅 GroupThread 在执掌进行中再发时启用）。
 * 消息常落在列表中段，默认贴底看不到——用 cue 滚到插入点并闪缩。
 * 单聊 API steer / 开局发言不走这套，避免「每条新消息都闪」。
 *
 * 禁止裸正文全局匹配：同文历史气泡很多，会闪到很久以前的那条。
 * - 有 messageId → 只认该 id
 * - 仅有 text → 必须是「插话前不存在的」新用户气泡（priorUserIds）
 */
export type ThreadInsertCue = {
  /** 递增；同文连插也能再触发。 */
  token: number;
  /** 优先按消息 id 命中（群落盘后已知）。 */
  messageId?: string;
  /** 按用户气泡正文精确匹配（单聊 steer 时尚无 id）。 */
  text?: string;
  /** steer 发出前线程里已有的用户消息 id；正文匹配时新气泡必须不在此集合。 */
  priorUserIds?: readonly string[];
};

export type ThreadInsertCueApi = {
  cue: Ref<ThreadInsertCue | null>;
  /** 单聊 steer 成功：用正文 + 插话前用户 id 快照，等新气泡出现。 */
  flashByText: (text: string, priorUserIds?: readonly string[]) => void;
  /** 群中途发言已进历史：用行 id。 */
  flashById: (messageId: string) => void;
  /** 某次 cue 已滚过 / 闪过，避免重复。 */
  consume: (token: number) => void;
};

export const threadInsertCueKey: InjectionKey<ThreadInsertCueApi> = Symbol("threadInsertCue");

export function injectThreadInsertCue(): ThreadInsertCueApi | undefined {
  return inject(threadInsertCueKey, undefined);
}

export function createThreadInsertCueApi(cue: Ref<ThreadInsertCue | null>): ThreadInsertCueApi {
  let token = 0;
  return {
    cue,
    flashByText(text, priorUserIds = []) {
      const body = text.trim();
      if (!body) return;
      token += 1;
      cue.value = {
        token,
        text: body,
        priorUserIds: [...priorUserIds],
      };
    },
    flashById(messageId) {
      const id = messageId.trim();
      if (!id) return;
      token += 1;
      cue.value = { token, messageId: id };
    },
    consume(seen) {
      if (cue.value?.token === seen) cue.value = null;
    },
  };
}

/**
 * UserMessage 是否应对上这次 cue。
 * id 优先；正文匹配时必须同时：
 * 1) 正文一致
 * 2) 不在 priorUserIds（插话前已有的用户气泡）
 * 3) 若提供 threadUserIds：是「插话后新出现的用户气泡」里的最后一条
 *    （避免同文旧气泡、也避免多个新气泡时抢闪）
 */
export function matchesInsertCue(
  cue: ThreadInsertCue | null | undefined,
  input: {
    messageId: string;
    text: string;
    /** 当前线程用户气泡 id（按时间序）。 */
    threadUserIds?: readonly string[];
  },
): boolean {
  if (!cue) return false;
  if (cue.messageId) return cue.messageId === input.messageId;

  const want = cue.text?.trim() ?? "";
  const got = input.text.trim();
  if (!want || want !== got) return false;

  // 插话前已有的气泡一律跳过（同文历史是这次 bug 的根因）
  if (cue.priorUserIds?.includes(input.messageId)) return false;

  if (input.threadUserIds && input.threadUserIds.length > 0 && cue.priorUserIds) {
    const prior = new Set(cue.priorUserIds);
    let lastNewId = "";
    for (const id of input.threadUserIds) {
      if (!prior.has(id)) lastNewId = id;
    }
    // 还没有任何新用户气泡：等下一轮
    if (!lastNewId) return false;
    return lastNewId === input.messageId;
  }

  return true;
}

/**
 * 列表里同文用户行取最后一条；可排除插话前已有 id（群落盘对 pending）。
 * 勿用 Array#find：会命中很久以前的同文行。
 */
export function lastUserMessageMatchingText<T extends { id: string; role?: string }>(
  list: readonly T[],
  text: string,
  plainText: (message: T) => string,
  excludeIds: readonly string[] = [],
): T | undefined {
  const want = text.trim();
  if (!want) return undefined;
  const excluded = excludeIds.length > 0 ? new Set(excludeIds) : null;
  let hit: T | undefined;
  for (const message of list) {
    if (message.role !== "user") continue;
    if (excluded?.has(message.id)) continue;
    if (plainText(message) === want) hit = message;
  }
  return hit;
}
