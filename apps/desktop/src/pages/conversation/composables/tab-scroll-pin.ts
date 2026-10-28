import { nextTick, onBeforeUnmount } from "vue";

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
 * 切 tab 前调用：先记下锚点顶边，布局落地后再对齐。
 * 高度骤变时挡住 stick-to-bottom 把视口拽走。
 */
export function useTabScrollPin() {
  let releasePin: (() => void) | null = null;

  function pinScrollTop(scroller: HTMLElement, top: number, ms: number) {
    releasePin?.();
    const hold = () => {
      scroller.scrollTop = top;
    };
    const release = () => {
      window.clearTimeout(timer);
      scroller.removeEventListener("scroll", hold);
      if (releasePin === release) releasePin = null;
    };
    scroller.addEventListener("scroll", hold);
    const timer = window.setTimeout(release, ms);
    releasePin = release;
  }

  function restore(anchor: HTMLElement, scroller: HTMLElement, beforeTop: number) {
    const delta = anchor.getBoundingClientRect().top - beforeTop;
    if (Math.abs(delta) < 0.5) return;
    const prevBehavior = scroller.style.scrollBehavior;
    scroller.style.scrollBehavior = "auto";
    const targetTop = scroller.scrollTop + delta;
    scroller.scrollTop = targetTop;
    scroller.style.scrollBehavior = prevBehavior;
    pinScrollTop(scroller, targetTop, 300);
  }

  function pin(anchor: HTMLElement | null): void {
    const scroller = scrollParentOf(anchor);
    const beforeTop = anchor?.getBoundingClientRect().top ?? null;
    void nextTick(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!anchor || !scroller || beforeTop === null) return;
          restore(anchor, scroller, beforeTop);
        });
      });
    });
  }

  onBeforeUnmount(() => releasePin?.());

  return { pin };
}
