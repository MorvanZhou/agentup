<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  disabled?: boolean;
  /** 无障碍名称（按钮本身的 aria-label） */
  ariaLabel: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="ariaLabel"
    :disabled="disabled"
    class="relative h-6 w-11 shrink-0 rounded-full border-0 transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/15 disabled:opacity-50"
    :class="modelValue ? 'bg-accent' : 'bg-muted'"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      class="absolute top-0.5 size-5 rounded-full bg-paper shadow transition duration-200"
      :class="modelValue ? 'left-5' : 'left-0.5'"
      aria-hidden="true"
    />
  </button>
</template>
