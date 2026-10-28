<script setup lang="ts">
import { ref, watch } from "vue";

defineProps<{
  /** 右侧工作区打开时，对话列盖在遮罩上面。 */
  sideOpen?: boolean;
}>();

const emit = defineEmits<{
  row: [el: HTMLElement | null];
}>();

const rowEl = ref<HTMLElement | null>(null);
watch(rowEl, (el) => emit("row", el), { immediate: true });
</script>

<template>
  <!-- 会话主列：顶栏和过程条通栏，消息与输入在左，单聊工作区走 side -->
  <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-paper text-foreground">
    <slot name="header" />
    <slot name="banner" />
    <slot name="process" />
    <div ref="rowEl" class="relative flex min-h-0 min-w-0 flex-1">
      <div
        class="relative flex min-h-0 min-w-80 min-w-0 flex-1 flex-col"
        :class="sideOpen ? 'z-30' : undefined"
      >
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <slot name="body" />
        </div>
        <slot name="dock" />
        <slot name="composer" />
        <slot name="resize" />
      </div>
      <slot name="side" />
    </div>
  </div>
</template>
