import { onBeforeUnmount, ref } from "vue";

import {
  COMPOSER_INPUT_MIN_HEIGHT,
  clampComposerInputHeight,
  loadComposerInputHeight,
  maxComposerInputHeight,
  rememberComposerInputHeight,
} from "../model/composer/composer-height";

const inputHeight = ref(loadComposerInputHeight());

/** 拖拽 Composer 上缘调整输入区高度；松手后写入 localStorage。各线程共用。 */
export function useComposerInputHeight() {
  let dragging = false;
  let startY = 0;
  let startHeight = 0;
  let container: HTMLElement | null = null;

  function onPointerMove(event: PointerEvent): void {
    if (!dragging || !container) return;
    const max = maxComposerInputHeight(container.getBoundingClientRect().height);
    const next = startHeight + (startY - event.clientY);
    inputHeight.value = clampComposerInputHeight(next, COMPOSER_INPUT_MIN_HEIGHT, max);
  }

  function stopDrag(): void {
    if (!dragging) return;
    dragging = false;
    container = null;
    document.body.classList.remove("select-none", "cursor-row-resize");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopDrag);
    window.removeEventListener("pointercancel", stopDrag);
    rememberComposerInputHeight(inputHeight.value);
  }

  function startResize(event: PointerEvent, host: HTMLElement): void {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    startY = event.clientY;
    startHeight = inputHeight.value;
    container = host;
    document.body.classList.add("select-none", "cursor-row-resize");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
  }

  onBeforeUnmount(stopDrag);

  return { inputHeight, startResize };
}
