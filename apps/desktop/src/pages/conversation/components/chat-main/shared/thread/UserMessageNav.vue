<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import { t } from "../../../../../../shared/model/ui/ui-locale";
import {
  userNavDockFalloff,
  userNavTickWidthPx,
  type UserMessageNavItem,
} from "../../../../model/thread/user-message-nav";

/** 离开标尺/浮层后稍延迟再关，避免移向清单时闪断。 */
const CLOSE_DELAY_MS = 140;

const props = defineProps<{
  items: readonly UserMessageNavItem[];
  activeId: string | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [id: string];
}>();

/** 鼠标是否在标尺或浮层气泡内。 */
const panelOpen = ref(false);
/** 当前指向的条目下标；-1 表示未指向具体行。 */
const hoverIndex = ref(-1);
/** 浮层相对视口定位（Teleport 避开 overflow 裁切）。 */
const panelPos = ref<{ top: string; right: string; maxHeight: string } | null>(null);

const navEl = ref<HTMLElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
let closeTimer = 0;

function previewLabel(preview: string): string {
  return preview || t("threadUserNavAttachmentOnly");
}

function onSelect(id: string): void {
  if (props.disabled) return;
  emit("select", id);
  closeNow();
}

function keepOpen(): void {
  window.clearTimeout(closeTimer);
  panelOpen.value = true;
  void placePanel();
}

function scheduleClose(): void {
  window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => {
    panelOpen.value = false;
    hoverIndex.value = -1;
    panelPos.value = null;
  }, CLOSE_DELAY_MS);
}

function closeNow(): void {
  window.clearTimeout(closeTimer);
  panelOpen.value = false;
  hoverIndex.value = -1;
  panelPos.value = null;
}

function onNavFocusOut(event: FocusEvent): void {
  const root = event.currentTarget as HTMLElement;
  const next = event.relatedTarget as Node | null;
  if (!next || !root.contains(next)) scheduleClose();
}

async function placePanel(): Promise<void> {
  await nextTick();
  const el = navEl.value;
  if (!el || !panelOpen.value) return;
  const rect = el.getBoundingClientRect();
  const maxHeight = Math.min(window.innerHeight * 0.52, Math.max(rect.height + 24, 240));
  let top = rect.top - 8;
  if (top + maxHeight > window.innerHeight - 12) {
    top = Math.max(12, window.innerHeight - 12 - maxHeight);
  }
  // 气泡右缘对齐标尺右缘，整体从右侧涨出
  panelPos.value = {
    top: `${top}px`,
    right: `${window.innerWidth - rect.right}px`,
    maxHeight: `${maxHeight}px`,
  };
}

function setHoverIndex(index: number): void {
  keepOpen();
  hoverIndex.value = index;
}

watch(hoverIndex, async (index) => {
  if (index < 0 || !panelOpen.value) return;
  await nextTick();
  const row = listEl.value?.querySelector<HTMLElement>(`li[data-nav-row="${index}"]`);
  row?.scrollIntoView({ block: "nearest" });
});

watch(panelOpen, (open) => {
  if (open) void placePanel();
});

onBeforeUnmount(() => {
  window.clearTimeout(closeTimer);
});

/**
 * 短横右对齐锚点，hover 时向左加长凸出（不整体 scale 文字）。
 * 邻项按距离衰减长度。
 */
function tickStyle(index: number, inPanel: boolean): Record<string, string> {
  const active = props.items[index]?.id === props.activeId;
  const hovering = hoverIndex.value >= 0;
  const distance = hovering ? Math.abs(index - hoverIndex.value) : Number.POSITIVE_INFINITY;
  const falloff = hovering ? userNavDockFalloff(distance) : 0;
  const isCenter = hovering && distance === 0;
  const width = userNavTickWidthPx({
    falloff: hovering ? falloff : 0,
    activeBoost: !hovering && active ? 0.35 : 0,
    base: 10,
    extra: inPanel ? 18 : 8,
  });
  const height = isCenter ? 2.5 : 2;
  const opacity = hovering
    ? 0.28 + 0.72 * Math.max(falloff, active ? 0.45 : 0)
    : active
      ? 0.9
      : 0.34;
  return {
    width: `${width.toFixed(1)}px`,
    height: `${height}px`,
    opacity: String(opacity),
  };
}

const collapsedTickStyles = computed(() =>
  props.items.map((_, index) => tickStyle(index, false)),
);
const panelTickStyles = computed(() => props.items.map((_, index) => tickStyle(index, true)));

/** 文字不放大；hover 行高亮，其余保持淡；微位移配合标尺凸出。 */
function rowTextStyle(index: number): Record<string, string> {
  const hovering = hoverIndex.value >= 0;
  const distance = hovering ? Math.abs(index - hoverIndex.value) : Number.POSITIVE_INFINITY;
  const falloff = hovering ? userNavDockFalloff(distance) : 0;
  const isCenter = hovering && distance === 0;
  // 凸出越长，文字越往左让一点
  const shift = -6 * falloff;
  return {
    transform: `translateX(${shift.toFixed(2)}px)`,
    opacity: isCenter ? "1" : hovering ? String(0.42 + 0.18 * falloff) : "0.55",
    color: isCenter ? "var(--color-foreground)" : "var(--color-muted-foreground)",
  };
}
</script>

<template>
  <!--
    标尺右对齐；hover 后气泡从右侧涨出完整清单。
    选中靠短横向左凸出 + 文字高亮微移。
  -->
  <nav
    ref="navEl"
    class="relative"
    :aria-label="t('threadUserNavLabel')"
    @pointerenter="keepOpen"
    @pointerleave="scheduleClose"
    @focusin="keepOpen"
    @focusout="onNavFocusOut"
  >
    <!-- 收起：仅右对齐短横 -->
    <div
      class="flex max-h-[min(18rem,42vh)] w-9 flex-col items-end overflow-y-auto py-1 pr-1"
      :class="panelOpen ? 'opacity-0' : 'opacity-100'"
      role="list"
      aria-hidden="true"
    >
      <button
        v-for="(item, index) in items"
        :key="item.id"
        type="button"
        tabindex="-1"
        class="inline-flex h-5 w-full cursor-pointer items-center justify-end focus-visible:outline-none disabled:cursor-default disabled:opacity-40"
        :disabled="disabled"
        @pointerenter="setHoverIndex(index)"
        @click="onSelect(item.id)"
      >
        <span
          class="user-nav-tick origin-right rounded-full bg-foreground"
          :style="collapsedTickStyles[index]"
        />
      </button>
    </div>

    <!-- 气泡清单：文案 + 右缘标尺同卡，从右侧 spring 涨出 -->
    <Teleport to="body">
      <div
        v-if="panelOpen && panelPos"
        class="user-nav-panel fixed z-[80] w-[min(17rem,48vw)] origin-right"
        :style="{
          top: panelPos.top,
          right: panelPos.right,
          maxHeight: panelPos.maxHeight,
        }"
        @pointerenter="keepOpen"
        @pointerleave="scheduleClose"
        @focusin="keepOpen"
      >
        <ul
          ref="listEl"
          class="user-nav-bubble bg-paper/97 flex max-h-[inherit] list-none flex-col overflow-y-auto rounded-2xl py-1.5 pr-1.5 pl-2 shadow-lg backdrop-blur-md"
          role="list"
        >
          <li
            v-for="(item, index) in items"
            :key="item.id"
            class="min-w-0 list-none"
            :data-nav-row="index"
          >
            <button
              type="button"
              class="user-nav-row text-muted-foreground flex w-full cursor-pointer items-center gap-1 py-1.5 pl-2 pr-1 text-left text-xs leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/30 disabled:cursor-default disabled:opacity-40"
              :aria-label="t('threadUserNavJump')"
              :aria-current="item.id === activeId ? 'location' : undefined"
              :disabled="disabled"
              @pointerenter="setHoverIndex(index)"
              @focus="setHoverIndex(index)"
              @click="onSelect(item.id)"
            >
              <span
                class="user-nav-text min-w-0 flex-1 truncate"
                :style="rowTextStyle(index)"
              >
                {{ previewLabel(item.preview) }}
              </span>
              <!-- 右对齐标尺：hover 向左加长凸出 -->
              <span
                class="user-nav-tick origin-right shrink-0 rounded-full bg-foreground"
                :class="hoverIndex === index || item.id === activeId ? 'user-nav-tick--hot' : ''"
                :style="panelTickStyles[index]"
                aria-hidden="true"
              />
            </button>
          </li>
        </ul>
      </div>
    </Teleport>
  </nav>
</template>

<style scoped>
.user-nav-tick {
  display: block;
  margin-left: auto;
  transition:
    width 240ms cubic-bezier(0.22, 1, 0.36, 1),
    height 200ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 180ms ease;
  will-change: width, height, opacity;
}

.user-nav-tick--hot {
  background: linear-gradient(
    90deg,
    color-mix(in oklab, var(--color-foreground) 25%, transparent),
    var(--color-foreground)
  );
}

.user-nav-text {
  transition:
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 180ms ease,
    color 180ms ease;
}

.user-nav-panel {
  animation: user-nav-bubble 420ms cubic-bezier(0.16, 1.2, 0.3, 1) both;
}

.user-nav-bubble {
  transform-origin: right center;
}

@keyframes user-nav-bubble {
  0% {
    opacity: 0;
    transform: scale(0.42);
  }
  55% {
    opacity: 1;
    transform: scale(1.045);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .user-nav-tick,
  .user-nav-text {
    transition-duration: 0.01ms;
  }

  .user-nav-panel {
    animation: none;
  }

  .user-nav-text {
    transform: none !important;
  }
}
</style>
