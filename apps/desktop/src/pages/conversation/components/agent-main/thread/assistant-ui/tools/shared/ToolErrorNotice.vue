<script setup lang="ts">
defineProps<{
  message: string;
}>();
</script>

<template>
  <!-- 工具执行失败：浅红底、红字，展开在卡片正文里 -->
  <p
    class="m-0 max-h-56 overflow-auto rounded-md bg-danger-soft px-3 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-destructive"
    role="alert"
  >{{ message }}</p>
</template>
