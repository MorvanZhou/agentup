<script setup lang="ts">
import { ArrowLeftIcon } from "@lucide/vue";

import { t } from "../model/ui/ui-locale";

defineProps<{
  title: string;
  /** 返回按钮无障碍文案；默认「返回上一页」 */
  backAriaLabel?: string;
}>();

const emit = defineEmits<{
  back: [];
}>();
</script>

<template>
  <!-- 编辑页顶栏：同 PageChromeHeader 形制，左侧加返回 -->
  <header
    class="app-drag flex h-12 shrink-0 items-center justify-between gap-3 border-b border-rule bg-paper-deep px-4"
  >
    <div class="app-no-drag flex min-w-0 items-center gap-2">
      <button
        type="button"
        class="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
        :aria-label="backAriaLabel || t('pageEditorBack')"
        @click="emit('back')"
      >
        <ArrowLeftIcon class="size-4" aria-hidden="true" />
      </button>
      <h1 class="m-0 min-w-0 truncate text-base font-semibold tracking-tight text-foreground">
        {{ title }}
      </h1>
    </div>
    <div v-if="$slots.actions" class="app-no-drag flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
