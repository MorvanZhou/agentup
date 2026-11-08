<script setup lang="ts">
import { ref } from "vue";

import { t } from "../../../../../shared/model/ui/ui-locale";

withDefaults(defineProps<{ resizable?: boolean }>(), { resizable: true });

const emit = defineEmits<{
  resize: [event: PointerEvent, host: HTMLElement];
}>();

const rootEl = ref<HTMLElement | null>(null);

function onResize(event: PointerEvent): void {
  const host = rootEl.value?.parentElement;
  if (!host) return;
  emit("resize", event, host);
}
</script>

<template>
  <!-- 对齐微信：输入区与聊天区同色，仅顶部分割线区分 -->
  <div ref="rootEl" class="relative shrink-0 border-t border-rule/80 bg-background">
    <button
      v-if="resizable"
      type="button"
      class="app-no-drag absolute inset-x-0 top-0 z-10 h-1.5 -translate-y-1/2 cursor-row-resize border-0 bg-transparent p-0 outline-none transition duration-200 hover:bg-muted focus-visible:bg-muted/80"
      :aria-label="t('composerResize')"
      @pointerdown="onResize"
    />
    <div class="mx-auto w-full">
      <slot />
    </div>
  </div>
</template>
