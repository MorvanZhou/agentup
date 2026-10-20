<script setup lang="ts">
defineProps<{
  modelValue: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}>();

defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <label class="grid gap-1.5 text-sm font-medium text-foreground">
    <!-- 通用下拉菜单 -->
    {{ label }}
    <select
      :value="modelValue"
      :disabled="disabled"
      class="min-h-8 min-w-0 rounded-lg border border-rule bg-paper px-3 text-sm font-normal text-foreground outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-50"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
  </label>
</template>
