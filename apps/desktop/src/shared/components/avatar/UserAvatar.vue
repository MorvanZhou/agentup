<script setup lang="ts">
import { CircleUserIcon } from "@lucide/vue";

withDefaults(
  defineProps<{
    name?: string;
    avatarUrl?: string;
    size?: "sm" | "md" | "lg";
  }>(),
  { size: "md" },
);

const sizeClass = {
  sm: "size-7",
  md: "size-9",
  lg: "size-10",
} as const;

const iconClass = {
  sm: "size-4",
  md: "size-5",
  lg: "size-7",
} as const;
</script>

<template>
  <span
    class="grid shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground"
    :class="sizeClass[size]"
  >
    <img
      v-if="avatarUrl"
      :src="avatarUrl"
      :alt="name || '用户'"
      class="size-full object-cover"
    />
    <CircleUserIcon
      v-else
      :class="iconClass[size]"
      aria-hidden="true"
    />
  </span>
</template>
