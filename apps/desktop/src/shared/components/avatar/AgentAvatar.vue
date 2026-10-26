<script setup lang="ts">
withDefaults(
  defineProps<{
    name: string;
    avatarUrl?: string;
    size?: "xs" | "sm" | "md" | "lg" | "sidebar" | "xl" | "2xl";
    /** 圆形头像（协助挂件）；默认圆角方。 */
    round?: boolean;
  }>(),
  { size: "md", round: false },
);

const sizeClass = {
  xs: "size-5 text-[10px]",
  sm: "size-7 text-xs",
  md: "size-8 text-sm",
  lg: "size-10 text-sm",
  sidebar: "size-12 text-sm",
  xl: "size-14 text-base",
  "2xl": "size-20 text-lg",
} as const;
</script>

<template>
  <img
    v-if="avatarUrl"
    :src="avatarUrl"
    :alt="name"
    class="shrink-0 object-cover"
    :class="[sizeClass[size], round ? 'rounded-full' : 'rounded-lg']"
  />
  <span
    v-else
    class="grid shrink-0 place-items-center bg-accent font-semibold text-white"
    :class="[sizeClass[size], round ? 'rounded-full' : 'rounded-lg']"
  >
    {{ name.slice(0, 1) || "A" }}
  </span>
</template>
