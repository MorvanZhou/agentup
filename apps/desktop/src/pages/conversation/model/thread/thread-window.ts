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

/**
 * 触顶自动加载的门闩。
 * 哨兵进入视口只加载一页；它还停在里面时不再连拉，离开之后才允许下一次。
 */
export function nextEarlierAutoLoad(
  armed: boolean,
  intersecting: boolean,
): { load: boolean; armed: boolean } {
  if (!intersecting) return { load: false, armed: true };
  if (!armed) return { load: false, armed: false };
  return { load: true, armed: false };
}

/**
 * 补上更早的消息之后，只有内容仍放得下、或视口已经贴在底部时，才继续跟随最新消息。
 * 用户停在半截历史时不能因为上方变高就滚回底部。
 */
export function followLatestAfterPrepend(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  if (scrollHeight <= clientHeight + 1) return true;
  return scrollHeight - scrollTop - clientHeight <= 1;
}

/** 让锚点消息回到补页前相对视口的位置。 */
export function scrollTopForAnchor(scrollTop: number, offsetBefore: number, offsetAfter: number): number {
  return scrollTop + (offsetAfter - offsetBefore);
}

/** 当前窗口内应挂载的消息 id（始终含最新一侧）。 */
export function visibleMessageIds(ids: readonly string[], start: number): string[] {
  if (start <= 0) return [...ids];
  if (start >= ids.length) return [];
  return ids.slice(start);
}
