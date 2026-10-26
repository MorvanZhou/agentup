<script setup lang="ts">
import { CodeIcon, EyeIcon } from "@lucide/vue";

export type PreviewModeTab = {
  id: string;
  label: string;
  icon: "eye" | "code";
};

const model = defineModel<string>({ required: true });

defineProps<{
  modes: PreviewModeTab[];
  ariaLabel: string;
}>();
</script>

<template>
  <!-- 查看方式分段：预览 / 原文·源码（chrome 内与工作区面板共用） -->
  <div
    class="flex items-center gap-0.5 rounded-lg border border-rule bg-paper p-0.5"
    role="tablist"
    :aria-label="ariaLabel"
  >
    <button
      v-for="mode in modes"
      :key="mode.id"
      type="button"
      role="tab"
      class="flex min-h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition duration-200 focus-visible:ring-2 focus-visible:ring-accent/40"
      :class="
        model === mode.id
          ? 'bg-paper-deep text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      "
      :aria-selected="model === mode.id"
      @click="model = mode.id"
    >
      <EyeIcon v-if="mode.icon === 'eye'" class="size-3.5 shrink-0" aria-hidden="true" />
      <CodeIcon v-else class="size-3.5 shrink-0" aria-hidden="true" />
      {{ mode.label }}
    </button>
  </div>
</template>
