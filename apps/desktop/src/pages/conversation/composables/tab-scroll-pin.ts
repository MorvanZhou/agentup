import { nextTick, onBeforeUnmount } from "vue";

import { scrollTopForAnchor } from "../model/thread/thread-window";

function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur) {
    const { overflowY } = getComputedStyle(cur);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return cur;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * 切 tab 前调用：当帧按住 scrollTop，布局落地后按气泡顶边对齐。
 * 避免高度骤变时首帧被 stick-to-bottom / scrollHeight 夹紧拽走造成闪一下。
 */
export function useTabScrollPin() {
  let releasePin: (() => void) | null = null;
  /** hold 回调读这个可变目标，restore 时先改目标再写 scrollTop，避免被旧值打回。 */
  let heldTop = 0;

  function pinScrollTop(scroller: HTMLElement, top: number, ms: number) {
    releasePin?.();
    heldTop = top;
    const hold = () => {
      if (scroller.scrollTop === heldTop) return;
      scroller.scrollTop = heldTop;
    };
    const release = () => {
      window.clearTimeout(timer);
      scroller.removeEventListener("scroll", hold);
      if (releasePin === release) releasePin = null;
    };
    scroller.scrollTop = heldTop;
    scroller.addEventListener("scroll", hold);
    const timer = window.setTimeout(release, ms);
    releasePin = release;
  }

  function restore(anchor: HTMLElement, scroller: HTMLElement, beforeTop: number) {
    const afterTop = anchor.getBoundingClientRect().top;
    if (Math.abs(afterTop - beforeTop) < 0.5) return;
    const prevBehavior = scroller.style.scrollBehavior;
    scroller.style.scrollBehavior = "auto";
    const targetTop = scrollTopForAnchor(scroller.scrollTop, beforeTop, afterTop);
    // 先更新 hold 目标，再写 scrollTop，否则 scroll 监听会把值打回旧 heldTop。
    heldTop = targetTop;
    scroller.scrollTop = targetTop;
    scroller.style.scrollBehavior = prevBehavior;
    pinScrollTop(scroller, targetTop, 300);
  }

  function pin(anchor: HTMLElement | null): void {
    const scroller = scrollParentOf(anchor);
    if (!anchor || !scroller) return;
    const beforeTop = anchor.getBoundingClientRect().top;
    // 切 tab 当帧先按住，挡住 stick-to-bottom 在首帧把视口拽走。
    pinScrollTop(scroller, scroller.scrollTop, 300);

    const sync = () => restore(anchor, scroller, beforeTop);
    const ro = new ResizeObserver(sync);
    ro.observe(anchor);

    void nextTick(() => {
      sync();
      // 双 rAF：等长→短时 scrollHeight 夹紧落地后再对齐一次。
      requestAnimationFrame(() => {
        sync();
        requestAnimationFrame(() => {
          sync();
          ro.disconnect();
        });
      });
    });
  }

  onBeforeUnmount(() => releasePin?.());

  return { pin };
}
