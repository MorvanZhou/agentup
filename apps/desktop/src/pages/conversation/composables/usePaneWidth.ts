import { onBeforeUnmount, ref, type Ref } from "vue";

import {
  SIDEBAR_MIN_WIDTH,
  WORKSPACE_MIN_WIDTH,
  clampPaneWidth,
  loadSidebarWidth,
  loadWorkspaceWidth,
  maxSidebarWidth,
  maxWorkspaceWidth,
  rememberSidebarWidth,
  rememberWorkspaceWidth,
} from "../model/layout/pane-width";

type Edge = "from-left" | "from-right";

const sidebarWidth = ref(loadSidebarWidth());
const workspaceWidth = ref(loadWorkspaceWidth());

/** 会话列表宽度；页面级共用。 */
export function useSidebarPaneWidth() {
  return usePaneWidth({
    width: sidebarWidth,
    min: SIDEBAR_MIN_WIDTH,
    maxFor: maxSidebarWidth,
    persist: rememberSidebarWidth,
  });
}

/** 工作空间宽度；各常驻线程共用同一份。 */
export function useWorkspacePaneWidth() {
  return usePaneWidth({
    width: workspaceWidth,
    min: WORKSPACE_MIN_WIDTH,
    maxFor: maxWorkspaceWidth,
    persist: rememberWorkspaceWidth,
  });
}

/** 拖拽分隔条调整面板宽度；松手后写入 localStorage。 */
function usePaneWidth(options: {
  width: Ref<number>;
  min: number;
  maxFor: (containerWidth: number) => number;
  persist: (width: number) => void;
}) {
  let dragging = false;
  let edge: Edge = "from-left";
  let container: HTMLElement | null = null;

  function onPointerMove(event: PointerEvent): void {
    if (!dragging || !container) return;
    const box = container.getBoundingClientRect();
    const next =
      edge === "from-left" ? event.clientX - box.left : box.right - event.clientX;
    const max = options.maxFor(box.width);
    // max 可能小于声明 min（例如要给对话区留 THREAD_MIN）；以可落区间为准。
    const min = Math.min(options.min, max);
    options.width.value = clampPaneWidth(next, min, max);
  }

  function stopDrag(): void {
    if (!dragging) return;
    dragging = false;
    container = null;
    document.body.classList.remove("select-none", "cursor-col-resize");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopDrag);
    window.removeEventListener("pointercancel", stopDrag);
    options.persist(options.width.value);
  }

  function startResize(event: PointerEvent, host: HTMLElement, dragEdge: Edge): void {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    edge = dragEdge;
    container = host;
    document.body.classList.add("select-none", "cursor-col-resize");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
    onPointerMove(event);
  }

  onBeforeUnmount(stopDrag);

  return { width: options.width, startResize };
}
