<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import { XIcon } from "@lucide/vue";

withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    /** md：确认框默认；lg：过程/历史等较宽内容 */
    size?: "md" | "lg";
  }>(),
  { size: "md" },
);

defineEmits<{ "update:open": [value: boolean] }>();
</script>

<template>
  <DialogRoot :open="open" @update:open="$emit('update:open', $event)">
    <!-- 通用弹窗 -->
    <DialogPortal>
      <DialogOverlay class="app-no-drag fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none" />
      <DialogContent
        class="app-no-drag fixed left-1/2 top-1/2 z-50 grid -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-rule bg-paper text-foreground shadow-xl outline-none"
        :class="
          size === 'lg'
            ? 'max-h-[min(85dvh,44rem)] w-[min(calc(100vw-2rem),40rem)]'
            : 'max-h-[min(80dvh,36rem)] w-[min(calc(100vw-2rem),32rem)]'
        "
      >
        <!-- 弹窗页头：可选 leading（如 Agent 头像） -->
        <header class="flex items-start gap-3 px-4 pt-3 pb-1">
          <div v-if="$slots.leading" class="mt-0.5 shrink-0">
            <slot name="leading" />
          </div>
          <div class="min-w-0 flex-1">
            <DialogTitle class="text-base font-semibold tracking-tight">{{ title }}</DialogTitle>
            <DialogDescription v-if="description" class="mb-0 mt-3 text-sm leading-snug text-muted-foreground">
              {{ description }}
            </DialogDescription>
          </div>
          <DialogClose
            class="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="关闭弹窗"
          >
            <XIcon class="size-4" />
          </DialogClose>
        </header>
        <!-- 弹窗内容（无 default slot 时不占位，避免确认框出现空白带） -->
        <div v-if="$slots.default" class="min-h-0 overflow-y-auto px-4 py-2">
          <slot />
        </div>
        <!-- 弹窗操作 -->
        <footer v-if="$slots.footer" class="flex w-full flex-wrap justify-end gap-2 px-4 py-3">
          <slot name="footer" />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
