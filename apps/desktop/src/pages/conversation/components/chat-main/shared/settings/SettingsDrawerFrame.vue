<script setup lang="ts">
import { XIcon } from "@lucide/vue";

import { t } from "../../../../../../shared/model/ui/ui-locale";

const emit = defineEmits<{
  close: [];
}>();

withDefaults(
  defineProps<{
    /** 关闭按钮 aria；缺省关闭对话设置 */
    closeLabel?: string;
  }>(),
  { closeLabel: "" },
);
</script>

<template>
  <!-- 设置抽屉壳：仅保留关闭；主区可滚动 -->
  <aside class="relative flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border bg-background">
    <button
      type="button"
      class="app-no-drag absolute top-2.5 right-2.5 z-[2] grid size-8 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground outline-none transition duration-200 hover:bg-paper hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
      :aria-label="closeLabel || t('chatSettingsClose')"
      @click="emit('close')"
    >
      <XIcon class="size-4" aria-hidden="true" />
    </button>

    <div class="relative z-[1] min-h-0 flex-1 overflow-y-auto px-3 pt-12 pb-3.5">
      <slot />
    </div>
  </aside>
</template>
