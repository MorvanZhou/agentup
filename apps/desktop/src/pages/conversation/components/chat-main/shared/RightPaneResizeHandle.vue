<script setup lang="ts">
/**
 * 右侧栏（工作区 / 对话设置 / 浏览器预览）左缘统一拖宽条。
 * 父级须 position:relative（或 absolute）且 z 高于对话列，否则 absolute 把手会锚错或被盖住点不到。
 * 外层传入 startResize(event)；host 为含「对话列 + 右侧栏」的整行，edge=from-right。
 */
defineProps<{
  startResize: (event: PointerEvent) => void;
}>();
</script>

<template>
  <!-- 贴在侧栏左缘；与会话列表右缘把手同一视觉规格 -->
  <button
    type="button"
    class="app-no-drag absolute inset-y-0 left-0 z-30 hidden w-1.5 -translate-x-1/2 cursor-col-resize border-0 bg-transparent p-0 outline-none transition duration-200 hover:bg-muted focus-visible:bg-muted/80 min-[730px]:block"
    aria-label="调整侧栏宽度"
    @pointerdown="startResize"
  />
</template>
