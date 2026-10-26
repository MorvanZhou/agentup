<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { InvocableSkill } from "../../../../../../../shared/model/runtime/runtime";

export type SkillPickerAnchor = {
  /** 视口坐标：光标左侧 */
  x: number;
  /** 视口坐标：光标顶部 */
  y: number;
  /** 视口坐标：光标底部 */
  bottom: number;
  /** 行高，用于下方翻转 */
  height: number;
};

const props = defineProps<{
  skills: InvocableSkill[];
  highlight: number;
  /** 光标锚点；缺省时贴近视口左下（少见）。 */
  anchor?: SkillPickerAnchor | null;
}>();

const emit = defineEmits<{
  select: [name: string];
  close: [];
}>();

/** 默认宽度；窄屏再被 place() 压到视口内。 */
const PANEL_WIDTH = 448;

const panelRef = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({
  position: "fixed",
  left: "0px",
  top: "0px",
  visibility: "hidden",
});

function place(): void {
  const el = panelRef.value;
  if (!el) return;
  const gap = 6;
  const pad = 8;
  const width = Math.min(el.offsetWidth || PANEL_WIDTH, window.innerWidth - pad * 2);
  const height = el.offsetHeight || 160;
  const line = Math.max(props.anchor?.height ?? 18, 14);
  let left = props.anchor?.x ?? pad;
  // 优先出现在光标上方，空间不够则翻到下方
  let top = (props.anchor?.y ?? pad) - height - gap;
  if (top < pad) {
    top = (props.anchor?.bottom ?? (props.anchor?.y ?? 0) + line) + gap;
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

function onDocPointerDown(event: PointerEvent): void {
  const target = event.target as Node | null;
  if (!target) return;
  if (panelRef.value?.contains(target)) return;
  emit("close");
}

function onWindowBlur(): void {
  emit("close");
}

function onVisibilityChange(): void {
  if (document.visibilityState === "hidden") emit("close");
}

watch(
  () => [props.anchor?.x, props.anchor?.y, props.anchor?.bottom, props.skills.length, props.highlight],
  schedulePlace,
);

onMounted(() => {
  schedulePlace();
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, true);
  window.addEventListener("blur", onWindowBlur);
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("visibilitychange", onVisibilityChange);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", place);
  window.removeEventListener("scroll", place, true);
  window.removeEventListener("blur", onWindowBlur);
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("visibilitychange", onVisibilityChange);
});
</script>

<template>
  <!-- Skill 选择浮层：贴在光标附近（Teleport 到 body，避免被输入区裁切） -->
  <Teleport to="body">
    <div
      ref="panelRef"
      class="max-h-56 w-[28rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-rule bg-paper py-1 shadow-md"
      role="listbox"
      aria-label="选择 Skill"
      :style="panelStyle"
    >
      <p
        v-if="!skills.length"
        class="m-0 px-3 py-2 text-xs text-muted-foreground"
        role="status"
      >
        没有匹配的 Skill
      </p>
      <button
        v-for="(skill, index) in skills"
        :key="skill.name"
        type="button"
        role="option"
        class="flex w-full items-start gap-2 px-3 py-1.5 text-left transition duration-200"
        :class="
          index === highlight
            ? 'bg-paper-deep text-foreground'
            : 'text-foreground hover:bg-paper-deep/70'
        "
        :aria-selected="index === highlight"
        @mousedown.prevent="emit('select', skill.name)"
      >
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium">/{{ skill.name }}</span>
          <span
            v-if="skill.description"
            class="mt-0.5 block truncate text-xs text-muted-foreground"
          >
            {{ skill.description }}
          </span>
        </span>
      </button>
    </div>
  </Teleport>
</template>
