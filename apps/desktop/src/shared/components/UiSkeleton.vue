<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 圆角：与控件阶梯对齐（标签 md · 钮/输入 lg · 卡/头像方块 xl · 圆头像 full） */
    rounded?: "md" | "lg" | "xl" | "full";
  }>(),
  { rounded: "md" },
);

const roundedClass = {
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  full: "rounded-full",
} as const;
</script>

<template>
  <!-- 骨架骨块：占位几何，勿写真实文案 -->
  <span
    class="block shrink-0 animate-pulse bg-muted motion-reduce:animate-none"
    :class="roundedClass[rounded]"
    aria-hidden="true"
  />
</template>
