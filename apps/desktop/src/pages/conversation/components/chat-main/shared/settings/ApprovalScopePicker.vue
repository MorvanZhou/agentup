<script setup lang="ts">
import type { ApprovalChoice } from "../../../../../../shared/api/runtime/agents";

defineProps<{
  value: ApprovalChoice;
  options: ReadonlyArray<{ value: ApprovalChoice; label: string }>;
  disabled?: boolean;
  /** 无障碍名：对应行标签 */
  labelledBy?: string;
}>();

const emit = defineEmits<{
  change: [value: ApprovalChoice];
}>();
</script>

<template>
  <!-- 审批范围分段：窄栏内等分芯片，替代裸 select -->
  <div
    class="grid gap-1 rounded-lg border border-rule bg-muted/40 p-1"
    :style="{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }"
    role="radiogroup"
    :aria-labelledby="labelledBy"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      class="min-h-7 rounded-md px-1.5 text-[11px] font-medium leading-tight transition duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
      :class="
        value === option.value
          ? 'bg-paper text-foreground shadow-sm ring-1 ring-accent/35'
          : 'text-muted-foreground hover:bg-paper/70 hover:text-foreground'
      "
      :aria-checked="value === option.value"
      :disabled="disabled"
      @click="emit('change', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
