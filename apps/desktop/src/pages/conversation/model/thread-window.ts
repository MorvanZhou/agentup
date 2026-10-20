/** 首屏与每次向上懒加载的消息条数（约 10 轮对话）。 */
export const THREAD_WINDOW_PAGE = 20;

/** 打开会话时从最新一侧起算的窗口起点。 */
export function initialWindowStart(total: number, pageSize = THREAD_WINDOW_PAGE): number {
  if (total <= 0) return 0;
  return Math.max(0, total - pageSize);
}

/** 向上再揭开一页更早的消息；已到顶时返回 0。 */
export function expandWindowStart(start: number, pageSize = THREAD_WINDOW_PAGE): number {
  return Math.max(0, start - pageSize);
}

/** 当前窗口内应挂载的消息 id（始终含最新一侧）。 */
export function visibleMessageIds(ids: readonly string[], start: number): string[] {
  if (start <= 0) return [...ids];
  if (start >= ids.length) return [];
  return ids.slice(start);
}
