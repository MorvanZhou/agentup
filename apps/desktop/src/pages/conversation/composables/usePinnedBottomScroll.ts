import { watch, type ComputedRef, type Ref } from "vue";

import { nextPinnedBottom } from "../model/thread/pinned-bottom-scroll";

/**
 * 在 enabled 期间把 scroller 贴在底部；用户上滑（高度未变）后松手，滚回底部再贴。
 * 用 ResizeObserver 跟内容增高，避免依赖外层 Thread 贴底。
 */
export function usePinnedBottomScroll(
  enabled: Ref<boolean> | ComputedRef<boolean>,
  scroller: Ref<HTMLElement | null>,
  content: Ref<HTMLElement | null>,
): void {
  watch(
    [enabled, scroller, content],
    ([isEnabled, scrollEl, contentEl], _, onCleanup) => {
      if (!isEnabled || !scrollEl || !contentEl) return;

      let pinned = true;
      let lastScrollTop = scrollEl.scrollTop;
      let lastScrollHeight = scrollEl.scrollHeight;

      const pin = () => {
        if (pinned) scrollEl.scrollTop = scrollEl.scrollHeight;
      };

      const onScroll = () => {
        pinned = nextPinnedBottom({
          pinned,
          scrollTop: scrollEl.scrollTop,
          lastScrollTop,
          scrollHeight: scrollEl.scrollHeight,
          lastScrollHeight,
          clientHeight: scrollEl.clientHeight,
        });
        lastScrollTop = scrollEl.scrollTop;
        lastScrollHeight = scrollEl.scrollHeight;
      };

      pin();
      scrollEl.addEventListener("scroll", onScroll);
      const observer = new ResizeObserver(pin);
      observer.observe(contentEl);
      onCleanup(() => {
        scrollEl.removeEventListener("scroll", onScroll);
        observer.disconnect();
      });
    },
    { flush: "post" },
  );
}
