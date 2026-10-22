<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import {
  buildFrequentEmojis,
  EMOJI_CATEGORIES,
  loadRecentEmojis,
  rememberRecentEmoji,
  type EmojiCategory,
} from "../../../../../model/composer/emoji-data";

export type EmojiPickerAnchor = {
  /** 锚点左边缘（视口） */
  left: number;
  /** 锚点上边缘（视口） */
  top: number;
  /** 锚点下边缘（视口） */
  bottom: number;
  /** 锚点宽度 */
  width: number;
};

const props = defineProps<{
  /** 表情按钮的视口矩形；缺省贴近视口左下。 */
  anchor?: EmojiPickerAnchor | null;
}>();

const emit = defineEmits<{
  select: [emoji: string];
  close: [];
}>();

const FREQUENT_ID = "frequent";

const panelRef = ref<HTMLElement | null>(null);
const recent = ref<string[]>(loadRecentEmojis());
const activeId = ref(FREQUENT_ID);
const panelStyle = ref<Record<string, string>>({
  position: "fixed",
  left: "0px",
  top: "0px",
  visibility: "hidden",
});

const tabs = computed(() => [
  { id: FREQUENT_ID, label: "常用", icon: "🕒" },
  ...EMOJI_CATEGORIES.map((c) => ({ id: c.id, label: c.label, icon: c.icon })),
]);

const activeEmojis = computed(() => {
  if (activeId.value === FREQUENT_ID) return buildFrequentEmojis(recent.value);
  const cat = EMOJI_CATEGORIES.find((c) => c.id === activeId.value) as EmojiCategory | undefined;
  return cat ? [...cat.emojis] : [];
});

function place(): void {
  const el = panelRef.value;
  if (!el) return;
  const gap = 8;
  const pad = 8;
  const width = Math.min(el.offsetWidth || 384, window.innerWidth - pad * 2);
  const height = el.offsetHeight || 320;
  // 微信式：优先出现在按钮上方，水平尽量贴按钮左侧
  let left = props.anchor?.left ?? pad;
  let top = (props.anchor?.top ?? window.innerHeight - pad) - height - gap;
  if (top < pad) {
    top = (props.anchor?.bottom ?? pad) + gap;
  }
  left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));
  top = Math.max(pad, Math.min(top, window.innerHeight - height - pad));
  panelStyle.value = {
    position: "fixed",
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(width)}px`,
    zIndex: "80",
    visibility: "visible",
  };
}

function schedulePlace(): void {
  void nextTick(() => place());
}

function onSelect(emoji: string): void {
  recent.value = rememberRecentEmoji(emoji);
  emit("select", emoji);
}

function onDocPointerDown(event: PointerEvent): void {
  const target = event.target as Node | null;
  if (!target) return;
  if (panelRef.value?.contains(target)) return;
  // 工具条表情钮本身由父级 toggle，这里不抢关
  const host = (target as HTMLElement).closest?.("[data-emoji-trigger]");
  if (host) return;
  emit("close");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
}

watch(
  () => [props.anchor?.left, props.anchor?.top, props.anchor?.bottom, activeId.value],
  schedulePlace,
);

onMounted(() => {
  schedulePlace();
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, true);
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKeydown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", place);
  window.removeEventListener("scroll", place, true);
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onKeydown, true);
});
</script>

<template>
  <!-- 表情选择浮层：贴在工具条表情钮附近（Teleport 避免被输入区裁切） -->
  <Teleport to="body">
    <div
      ref="panelRef"
      class="flex w-96 flex-col overflow-hidden rounded-xl border border-rule bg-paper shadow-md"
      role="dialog"
      aria-label="选择表情"
      :style="panelStyle"
      @mousedown.prevent
    >
      <!-- 表情网格 -->
      <div class="max-h-64 overflow-y-auto p-2">
        <div class="grid grid-cols-8 gap-1">
          <button
            v-for="(emoji, index) in activeEmojis"
            :key="`${activeId}-${index}-${emoji}`"
            type="button"
            class="grid aspect-square place-items-center rounded-md text-2xl leading-none transition duration-200 hover:bg-paper-deep"
            :aria-label="`插入 ${emoji}`"
            @click="onSelect(emoji)"
          >
            <span aria-hidden="true">{{ emoji }}</span>
          </button>
        </div>
        <p
          v-if="!activeEmojis.length"
          class="m-0 px-1 py-6 text-center text-xs text-muted-foreground"
          role="status"
        >
          暂无表情
        </p>
      </div>

      <!-- 分类底栏 -->
      <div class="flex items-stretch gap-0.5 border-t border-rule bg-background px-1 py-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="grid min-h-8 min-w-0 flex-1 place-items-center rounded-md text-base transition duration-200"
          :class="
            tab.id === activeId
              ? 'bg-paper-deep text-foreground'
              : 'text-muted-foreground hover:bg-paper-deep/70 hover:text-foreground'
          "
          :aria-label="tab.label"
          :aria-pressed="tab.id === activeId"
          :title="tab.label"
          @click="activeId = tab.id"
        >
          <span aria-hidden="true">{{ tab.icon }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>
