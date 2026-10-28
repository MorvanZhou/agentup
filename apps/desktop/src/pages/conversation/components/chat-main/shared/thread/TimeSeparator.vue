<script setup lang="ts">
defineProps<{
  label: string;
}>();
</script>

<template>
  <li class="flex justify-center py-1" role="separator" :aria-label="label">
    <!-- 时间分隔 -->
    <span class="shrink-0 text-xs text-muted-foreground">{{ label }}</span>
  </li>
</template>
