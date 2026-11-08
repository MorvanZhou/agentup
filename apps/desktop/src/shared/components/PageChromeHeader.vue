<script setup lang="ts">
defineProps<{
  title: string;
}>();
</script>

<template>
  <!-- 应用页顶栏：拖拽区 · 主标题 · 右侧操作；全 app 列表/设置主区统一用这一套 -->
  <header
    class="app-drag flex h-12 shrink-0 items-center justify-between gap-3 border-b border-rule bg-paper-deep px-4"
  >
    <h1 class="m-0 min-w-0 truncate text-base font-semibold tracking-tight text-foreground">
      {{ title }}
    </h1>
    <div v-if="$slots.actions" class="app-no-drag flex min-w-0 shrink items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
