<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { MinusIcon, PlusIcon, RotateCcwIcon, XIcon } from "@lucide/vue";

import {
  formatPreviewScale,
  nextPreviewScale,
  wheelPreviewScale,
} from "../model/image-preview";

const open = defineModel<boolean>("open", { default: false });

const props = withDefaults(
  defineProps<{
    src: string;
    alt?: string;
  }>(),
  { alt: "图片预览" },
);

const scale = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);
const dragging = ref(false);
let dragOriginX = 0;
let dragOriginY = 0;
let dragStartX = 0;
let dragStartY = 0;
let movedWhileDrag = false;

const scaleLabel = computed(() => formatPreviewScale(scale.value));
const imageStyle = computed(() => ({
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value})`,
  cursor: dragging.value ? "grabbing" : "grab",
}));

function resetView(): void {
  scale.value = 1;
  offsetX.value = 0;
  offsetY.value = 0;
}

function close(): void {
  open.value = false;
}

function zoomIn(): void {
  scale.value = nextPreviewScale(scale.value, 1);
}

function zoomOut(): void {
  scale.value = nextPreviewScale(scale.value, -1);
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  scale.value = wheelPreviewScale(scale.value, event.deltaY);
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  dragging.value = true;
  movedWhileDrag = false;
  dragOriginX = offsetX.value;
  dragOriginY = offsetY.value;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  const dx = event.clientX - dragStartX;
  const dy = event.clientY - dragStartY;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movedWhileDrag = true;
  offsetX.value = dragOriginX + dx;
  offsetY.value = dragOriginY + dy;
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  try {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  } catch {
    /* 已释放时忽略 */
  }
}

function onBackdropClick(): void {
  if (movedWhileDrag) {
    movedWhileDrag = false;
    return;
  }
  close();
}

function onKeydown(event: KeyboardEvent): void {
  if (!open.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    zoomIn();
    return;
  }
  if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    zoomOut();
    return;
  }
  if (event.key === "0") {
    event.preventDefault();
    resetView();
  }
}

watch(open, (value) => {
  if (typeof document === "undefined") return;
  document.body.style.overflow = value ? "hidden" : "";
  if (value) resetView();
});

watch(
  () => props.src,
  () => {
    if (open.value) resetView();
  },
);

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  if (typeof document !== "undefined") document.body.style.overflow = "";
});
</script>

<template>
  <!-- 统一图片预览：缩放 / 拖拽 -->
  <Teleport to="body">
    <div
      v-if="open && src"
      class="app-no-drag fixed inset-0 z-[100] flex flex-col bg-black/70"
      data-testid="image-preview"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      @click.self="onBackdropClick"
      @wheel.prevent="onWheel"
    >
      <!-- 顶栏 -->
      <header class="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-end p-3">
        <button
          type="button"
          class="pointer-events-auto grid size-8 place-items-center rounded-lg bg-black/40 text-white transition duration-200 hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          aria-label="关闭预览"
          @click="close"
        >
          <XIcon class="size-4" />
        </button>
      </header>

      <!-- 画布 -->
      <div
        class="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4"
        @click.self="onBackdropClick"
      >
        <!-- 衬底：透明图不与深色遮罩融合 -->
        <div
          :style="imageStyle"
          class="image-preview-mat inline-block max-h-[min(85dvh,calc(100vh-6rem))] max-w-[min(96vw,72rem)] origin-center rounded-xl p-3 shadow-lg motion-reduce:transition-none"
          :class="dragging ? undefined : 'transition-transform duration-75'"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @click.stop
          @dblclick.prevent="resetView"
        >
          <img
            :src="src"
            :alt="alt"
            class="block h-auto max-h-[min(80dvh,calc(100vh-7rem))] w-auto max-w-[min(94vw,70rem)] select-none object-contain"
            draggable="false"
            @dragstart.prevent
          />
        </div>
      </div>

      <!-- 缩放工具条 -->
      <footer class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3">
        <div
          class="pointer-events-auto flex items-center gap-1 rounded-lg border border-white/15 bg-black/55 px-2 py-1 text-white shadow-md backdrop-blur-sm"
        >
          <button
            type="button"
            class="grid size-7 place-items-center rounded-md transition duration-200 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="缩小"
            @click="zoomOut"
          >
            <MinusIcon class="size-3.5" />
          </button>
          <span class="min-w-12 text-center text-xs tabular-nums" aria-live="polite">{{ scaleLabel }}</span>
          <button
            type="button"
            class="grid size-7 place-items-center rounded-md transition duration-200 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="放大"
            @click="zoomIn"
          >
            <PlusIcon class="size-3.5" />
          </button>
          <button
            type="button"
            class="grid size-7 place-items-center rounded-md transition duration-200 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="重置视图"
            @click="resetView"
          >
            <RotateCcwIcon class="size-3.5" />
          </button>
        </div>
      </footer>
    </div>
  </Teleport>
</template>

<style>
/* 棋盘格衬底：提示透明区域，并与遮罩分离 */
.image-preview-mat {
  background-color: #f7f2ea;
  background-image:
    linear-gradient(45deg, #e6ddd0 25%, transparent 25%),
    linear-gradient(-45deg, #e6ddd0 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e6ddd0 75%),
    linear-gradient(-45deg, transparent 75%, #e6ddd0 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
}

.dark .image-preview-mat {
  background-color: #1a1a1a;
  background-image:
    linear-gradient(45deg, #2e2e2e 25%, transparent 25%),
    linear-gradient(-45deg, #2e2e2e 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #2e2e2e 75%),
    linear-gradient(-45deg, transparent 75%, #2e2e2e 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
}
</style>
