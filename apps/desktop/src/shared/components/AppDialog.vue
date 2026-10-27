<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import { ChevronDownIcon, XIcon } from "@lucide/vue";

import { t } from "../model/ui/ui-locale";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    /** md：确认框默认；lg：过程/历史等较宽内容 */
    size?: "md" | "lg";
    /** start：确认框；center：头像与标题垂直居中 */
    align?: "start" | "center";
    titleClass?: string;
    descriptionClass?: string;
    /** 说明默认两行；超出才出现展开，短说明保持原样 */
    descriptionClamp?: boolean;
  }>(),
  {
    size: "md",
    align: "start",
    titleClass: "text-base font-semibold tracking-tight",
    descriptionClass: "mb-0 mt-3 text-sm leading-snug text-muted-foreground",
    descriptionClamp: false,
  },
);

defineEmits<{ "update:open": [value: boolean] }>();

const descriptionOpen = ref(false);
const descriptionOverflows = ref(false);
const descriptionEl = ref<{ $el?: unknown } | HTMLElement | null>(null);
let descriptionObserver: ResizeObserver | null = null;

const showDescriptionToggle = computed(
  () => props.descriptionClamp && (descriptionOverflows.value || descriptionOpen.value),
);

function descriptionNode(): HTMLElement | null {
  const current = descriptionEl.value;
  if (current instanceof HTMLElement) return current;
  const root = current?.$el;
  return root instanceof HTMLElement ? root : null;
}

function measureDescription(): void {
  const el = descriptionNode();
  if (!el || !props.descriptionClamp || descriptionOpen.value) return;
  descriptionOverflows.value = el.scrollHeight > el.clientHeight + 1;
}

function toggleDescription(): void {
  descriptionOpen.value = !descriptionOpen.value;
  if (!descriptionOpen.value) void nextTick(measureDescription);
}

watch(descriptionEl, () => {
  descriptionObserver?.disconnect();
  descriptionObserver = null;
  const node = descriptionNode();
  if (!node) return;
  if (typeof ResizeObserver === "undefined") {
    void nextTick(measureDescription);
    return;
  }
  descriptionObserver = new ResizeObserver(() => measureDescription());
  descriptionObserver.observe(node);
  measureDescription();
});

watch(
  () => [props.open, props.description] as const,
  () => {
    descriptionOpen.value = false;
    descriptionOverflows.value = false;
    void nextTick(measureDescription);
  },
);

onUnmounted(() => descriptionObserver?.disconnect());
</script>

<template>
  <DialogRoot :open="open" @update:open="$emit('update:open', $event)">
    <!-- 通用弹窗 -->
    <DialogPortal>
      <DialogOverlay class="app-no-drag fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none" />
      <DialogContent
        class="app-no-drag fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-rule bg-paper text-foreground shadow-xl outline-none"
        :class="
          size === 'lg'
            ? 'max-h-[min(85dvh,44rem)] w-[min(calc(100vw-2rem),40rem)]'
            : 'max-h-[min(80dvh,36rem)] w-[min(calc(100vw-2rem),32rem)]'
        "
      >
        <!-- 弹窗页头：可选 leading（如 Agent 头像）；标题与说明在其右侧 -->
        <header
          class="flex shrink-0 px-4"
          :class="align === 'center' ? 'items-center gap-4 pt-4 pb-3' : 'items-start gap-3 pt-3 pb-1'"
        >
          <div v-if="$slots.leading" class="shrink-0" :class="align === 'start' ? 'mt-0.5' : ''">
            <slot name="leading" />
          </div>
          <div class="min-w-0 flex-1">
            <DialogTitle :class="titleClass">{{ title }}</DialogTitle>
            <DialogDescription v-if="description && !descriptionClamp" :class="descriptionClass">
              {{ description }}
            </DialogDescription>
            <!-- 过长说明：默认两行；line-clamp 与 block 冲突，折叠态不要再加 display -->
            <div v-else-if="description" class="min-w-0">
              <DialogDescription
                ref="descriptionEl"
                :class="[
                  descriptionClass,
                  'whitespace-pre-wrap break-words',
                  descriptionOpen
                    ? 'max-h-48 overflow-y-auto overscroll-contain'
                    : 'line-clamp-2 max-h-12 overflow-hidden',
                ]"
              >{{ description }}</DialogDescription>
              <button
                v-if="showDescriptionToggle"
                type="button"
                class="mt-1 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground transition duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                :aria-expanded="descriptionOpen"
                @click="toggleDescription"
              >
                <ChevronDownIcon
                  class="size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none"
                  :class="descriptionOpen ? 'rotate-180' : ''"
                  aria-hidden="true"
                />
                {{ descriptionOpen ? t("dialogDescriptionCollapse") : t("dialogDescriptionExpand") }}
              </button>
            </div>
          </div>
          <DialogClose
            class="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="关闭弹窗"
          >
            <XIcon class="size-4" />
          </DialogClose>
        </header>
        <!-- 弹窗内容：超长时在中间区域滚动，页头/页脚固定 -->
        <div v-if="$slots.default" class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2">
          <slot />
        </div>
        <!-- 弹窗操作 -->
        <footer v-if="$slots.footer" class="flex w-full shrink-0 flex-wrap justify-end gap-2 px-4 py-3">
          <slot name="footer" />
        </footer>
      </DialogContent>

    </DialogPortal>
  </DialogRoot>
</template>
