<script setup lang="ts">
import { onMounted, onUnmounted, useSlots, watch } from "vue";
import { XIcon } from "@lucide/vue";

import { t } from "../../model/ui/ui-locale";
import PreviewRevealButton from "./PreviewRevealButton.vue";

/** 多层预览叠加时共用一把 body 滚动锁 */
let bodyScrollLocks = 0;

function lockBodyScroll(): void {
  if (typeof document === "undefined") return;
  bodyScrollLocks += 1;
  document.body.style.overflow = "hidden";
}

function unlockBodyScroll(): void {
  if (typeof document === "undefined") return;
  bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
  if (bodyScrollLocks === 0) document.body.style.overflow = "";
}

const open = defineModel<boolean>("open", { default: false });

const props = withDefaults(
  defineProps<{
    /** data-testid */
    testId: string;
    /** dialog aria-label */
    ariaLabel: string;
    /** chrome 左侧标题（文件名等） */
    title?: string;
    /** 点遮罩关闭（图片预览） */
    closeOnBackdrop?: boolean;
    /** 返回 true 时 Esc 不关闭（例如上层还有图片预览） */
    escapeGuard?: () => boolean;
    /** 舞台额外 class（如图片棋盘格场景） */
    stageClass?: string;
    /** 内容区额外 class */
    bodyClass?: string;
    /** 显示「在文件管理器中打开所在位置」 */
    showReveal?: boolean;
  }>(),
  {
    title: undefined,
    closeOnBackdrop: false,
    escapeGuard: undefined,
    stageClass: undefined,
    bodyClass: undefined,
    showReveal: false,
  },
);

const emit = defineEmits<{
  wheel: [event: WheelEvent];
  reveal: [];
}>();

const slots = useSlots();

function close(): void {
  open.value = false;
}

function onBackdropClick(): void {
  if (!props.closeOnBackdrop) return;
  close();
}

function onKeydown(event: KeyboardEvent): void {
  if (!open.value) return;
  if (event.key !== "Escape") return;
  if (props.escapeGuard?.()) return;
  event.preventDefault();
  event.stopPropagation();
  close();
}

watch(open, (value, wasOpen) => {
  if (value && !wasOpen) lockBodyScroll();
  else if (!value && wasOpen) unlockBodyScroll();
});

onMounted(() => {
  window.addEventListener("keydown", onKeydown, true);
  if (open.value) lockBodyScroll();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown, true);
  if (open.value) unlockBodyScroll();
});
</script>

<template>
  <!-- 全屏预览壳：遮罩 + 舞台；chrome 压在舞台顶边内部（浏览器工具条式）。
       pointer-events-auto：Dialog 会把 body 设为 pointer-events:none。
       pointerdown.stop：挡住 document 外侧 pointerdown，避免下层 Dialog 一并关闭。 -->
  <Teleport to="body">
    <div
      v-if="open"
      class="app-no-drag pointer-events-auto fixed inset-0 z-[100] flex items-stretch justify-center bg-black/55 p-4 backdrop-blur-md"
      :data-testid="testId"
      role="dialog"
      aria-modal="true"
      :aria-label="ariaLabel"
      @pointerdown.stop
      @click.self="onBackdropClick"
      @wheel="emit('wheel', $event)"
    >
      <div
        class="flex min-h-0 w-full max-w-[min(96vw,72rem)] flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-paper shadow-md"
        :class="stageClass"
        @click.stop
      >
        <!-- chrome：左仅文件名；右为查看方式 / 操作；关闭单独成组防误触 -->
        <header
          class="flex shrink-0 items-center gap-2 border-b border-rule bg-paper px-2.5 py-1.5"
        >
          <p
            v-if="title"
            class="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
            :title="title"
          >
            {{ title }}
          </p>
          <div v-else class="min-w-0 flex-1" />
          <div class="flex shrink-0 items-center gap-1.5">
            <div v-if="slots['view-mode']" class="min-w-0 shrink-0">
              <slot name="view-mode" />
            </div>
            <slot name="actions" />
            <PreviewRevealButton v-if="showReveal" @click="emit('reveal')" />
          </div>
          <div class="flex shrink-0 items-center border-l border-rule pl-2">
            <button
              type="button"
              class="grid size-7 place-items-center rounded-lg text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
              :aria-label="t('msgPreviewClose')"
              @click="close"
            >
              <XIcon class="size-3.5" />
            </button>
          </div>
        </header>

        <div class="flex min-h-0 flex-1 flex-col overflow-hidden" :class="bodyClass">
          <slot />
        </div>

        <footer
          v-if="slots.footer"
          class="flex shrink-0 items-center justify-center border-t border-rule bg-paper px-2 py-1.5"
        >
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
