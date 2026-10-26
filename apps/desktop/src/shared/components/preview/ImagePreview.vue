<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { MinusIcon, PlusIcon, RotateCcwIcon } from "@lucide/vue";

import { previewFileName } from "../../model/preview/file-name";
import {
  formatPreviewScale,
  nextPreviewScale,
  wheelPreviewScale,
} from "../../model/preview/image-preview";
import { t } from "../../model/ui/ui-locale";
import PreviewShell from "./PreviewShell.vue";

const open = defineModel<boolean>("open", { default: false });

const props = withDefaults(
  defineProps<{
    src: string;
    alt?: string;
    /** 工作区相对路径；有值时显示「在文件夹中显示」 */
    revealPath?: string;
  }>(),
  { alt: undefined, revealPath: undefined },
);

const emit = defineEmits<{
  reveal: [];
}>();

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
const previewAlt = computed(() => props.alt || t("msgImagePreview"));
const chromeTitle = computed(() =>
  props.revealPath ? previewFileName(props.revealPath) : previewAlt.value,
);
const imageStyle = computed(() => ({
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value})`,
  cursor: dragging.value ? "grabbing" : "grab",
}));

function resetView(): void {
  scale.value = 1;
  offsetX.value = 0;
  offsetY.value = 0;
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

function onBodyClick(): void {
  if (movedWhileDrag) {
    movedWhileDrag = false;
    return;
  }
  open.value = false;
}

function onZoomKeydown(event: KeyboardEvent): void {
  if (!open.value) return;
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
  if (value) resetView();
});

watch(
  () => props.src,
  () => {
    if (open.value) resetView();
  },
);

onMounted(() => {
  window.addEventListener("keydown", onZoomKeydown, true);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onZoomKeydown, true);
});
</script>

<template>
  <PreviewShell
    v-if="src"
    v-model:open="open"
    test-id="image-preview"
    :aria-label="t('msgImagePreview')"
    :title="chromeTitle"
    close-on-backdrop
    :show-reveal="Boolean(revealPath)"
    stage-class="max-h-[min(92dvh,calc(100vh-2rem))]"
    body-class="image-preview-body"
    @wheel="onWheel"
    @reveal="emit('reveal')"
  >
    <div
      class="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4"
      @click.self="onBodyClick"
    >
      <div
        :style="imageStyle"
        class="image-preview-mat inline-block max-h-full max-w-full origin-center motion-reduce:transition-none"
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
          :alt="previewAlt"
          class="block h-auto max-h-[min(70dvh,calc(100vh-12rem))] w-auto max-w-[min(90vw,68rem)] select-none object-contain"
          draggable="false"
          @dragstart.prevent
        />
      </div>
    </div>

    <template #footer>
      <div class="flex items-center gap-1 text-foreground">
        <button
          type="button"
          class="grid size-7 place-items-center rounded-md text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
          aria-label="缩小"
          @click="zoomOut"
        >
          <MinusIcon class="size-3.5" />
        </button>
        <span class="min-w-12 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">{{
          scaleLabel
        }}</span>
        <button
          type="button"
          class="grid size-7 place-items-center rounded-md text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
          aria-label="放大"
          @click="zoomIn"
        >
          <PlusIcon class="size-3.5" />
        </button>
        <button
          type="button"
          class="grid size-7 place-items-center rounded-md text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
          aria-label="重置视图"
          @click="resetView"
        >
          <RotateCcwIcon class="size-3.5" />
        </button>
      </div>
    </template>
  </PreviewShell>
</template>

<style>
/* 棋盘格：内容区提示透明像素 */
.image-preview-body {
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

.dark .image-preview-body {
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

.image-preview-mat {
  background: transparent;
}
</style>
