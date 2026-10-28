/** 界面向上翻页时，每一页的消息条数。当前一对一会话不受这个上限切开。 */
export const TRANSCRIPT_PAGE_SIZE = 20;

export const TRANSCRIPT_PAGE_MAX = 100;

export type TranscriptPageQuery =
  | { full: true }
  | { full: false; limit: number; beforeId?: string };

/** 没有 limit / before 时保持整段读取。limit 非法时返回 null。 */
export function parseTranscriptPageQuery(
  limitRaw: string | undefined,
  beforeRaw: string | undefined,
): TranscriptPageQuery | null {
  const before = beforeRaw?.trim() || undefined;
  const hasLimit = limitRaw != null && limitRaw !== "";
  if (!hasLimit && !before) return { full: true };
  let limit = TRANSCRIPT_PAGE_SIZE;
  if (hasLimit) {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > TRANSCRIPT_PAGE_MAX) return null;
    limit = parsed;
  }
  return before ? { full: false, limit, beforeId: before } : { full: false, limit };
}

/** 取 `beforeId` 之前（或时间线末尾）的最近 `limit` 条，顺序仍是从旧到新。 */
export function pageItems<T extends { id: string }>(
  items: readonly T[],
  options: { limit: number; beforeId?: string },
): { items: T[]; hasMore: boolean } {
  if (options.limit <= 0) return { items: [], hasMore: false };
  let end = items.length;
  if (options.beforeId) {
    end = items.findIndex((item) => item.id === options.beforeId);
    if (end < 0) return { items: [], hasMore: false };
  }
  const start = Math.max(0, end - options.limit);
  return { items: items.slice(start, end), hasMore: start > 0 };
}
