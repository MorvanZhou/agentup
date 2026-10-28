/**
 * 流式限高容器的「贴底」判定。
 * 自动 pin 产生的 scroll 事件可能落在内容增高之后，会短暂「不在底部」；
 * 只有 scrollHeight 未变且向上滚，才视为用户意图离开底部。
 */

export type PinnedBottomScrollSample = {
  pinned: boolean;
  scrollTop: number;
  lastScrollTop: number;
  scrollHeight: number;
  lastScrollHeight: number;
  clientHeight: number;
};

export function isScrollAtBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return (
    Math.abs(scrollHeight - scrollTop - clientHeight) <= 1 ||
    scrollHeight <= clientHeight
  );
}

/** 根据一次 scroll 事件更新是否仍贴底。 */
export function nextPinnedBottom(sample: PinnedBottomScrollSample): boolean {
  if (
    isScrollAtBottom(sample.scrollTop, sample.scrollHeight, sample.clientHeight)
  ) {
    return true;
  }
  if (
    sample.scrollTop < sample.lastScrollTop &&
    sample.scrollHeight === sample.lastScrollHeight
  ) {
    return false;
  }
  return sample.pinned;
}
