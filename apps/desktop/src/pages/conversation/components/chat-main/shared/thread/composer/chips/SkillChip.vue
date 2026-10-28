<script setup lang="ts">
import { SparklesIcon, XIcon } from "@lucide/vue";
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    name: string;
    removable?: boolean;
    /** Composer 用 accent；用户气泡用 on-primary 半透明。 */
    variant?: "accent" | "on-primary";
  }>(),
  { variant: "accent" },
);

const emit = defineEmits<{
  remove: [];
}>();

const chipClass = computed(() =>
  props.variant === "on-primary"
    ? "border-white/25 bg-white/15 text-inherit"
    : "border-accent/30 bg-accent/10 text-accent",
);

const removeClass = computed(() =>
  props.variant === "on-primary"
    ? "opacity-70 hover:bg-white/20 hover:opacity-100"
    : "text-accent/70 hover:bg-accent/15 hover:text-accent",
);
</script>

<template>
  <!-- Skill 引用芯片 -->
  <span
    class="inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium"
    :class="chipClass"
    :data-skill="name"
    :title="`/${name}`"
  >
    <SparklesIcon class="size-3 shrink-0" aria-hidden="true" />
    <span class="truncate">/{{ name }}</span>
    <button
      v-if="removable"
      type="button"
      class="grid size-3.5 shrink-0 place-items-center rounded-sm border-0 bg-transparent p-0 transition duration-200"
      :class="removeClass"
      :aria-label="`移除 /${name}`"
      @mousedown.prevent="emit('remove')"
    >
      <XIcon class="size-3" />
    </button>
  </span>
</template>
