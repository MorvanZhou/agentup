<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

import { t } from "../../../../../../../shared/model/ui/ui-locale";

const props = defineProps<{
  active: boolean;
  title: string;
  detail?: string;
  /** 工具执行失败：标题下加红色波浪线 */
  error?: boolean;
}>();

const displayTitle = computed(() => {
  const title = props.title;
  if (!title) return title;
  return title.charAt(0).toUpperCase() + title.slice(1);
});

const reduceMotion = ref(false);
let motionQuery: MediaQueryList | null = null;

const onMotionChange = () => {
  reduceMotion.value = motionQuery?.matches ?? false;
};

onMounted(() => {
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  reduceMotion.value = motionQuery.matches;
  motionQuery.addEventListener("change", onMotionChange);
});

onUnmounted(() => {
  motionQuery?.removeEventListener("change", onMotionChange);
});
</script>

<template>
  <span
    class="inline-flex min-w-0 max-w-full flex-1 items-baseline gap-1.5"
    :aria-busy="active || undefined"
    :title="detail ? `${displayTitle}  ${detail}` : displayTitle"
  >
    <span
      class="shrink-0 font-medium"
      :class="
        error
          ? 'underline decoration-destructive decoration-wavy underline-offset-[3px]'
          : active && !reduceMotion && 'aui-title-shimmer'
      "
    >{{ displayTitle }}</span>
    <span
      v-if="detail"
      class="text-muted-foreground min-w-0 truncate font-mono text-xs"
    >{{ detail }}</span>
    <span
      v-if="active && reduceMotion"
      class="text-muted-foreground shrink-0 text-xs"
    >{{ t("msgInProgress") }}</span>
  </span>
</template>

<style scoped>
.aui-title-shimmer {
  /*
    暗色下 currentColor 接近白，细高光几乎看不见。
    基底压到冷灰，亮带用钛银高光单向扫过（偏科技感，不用品牌橙）。
  */
  background-image: linear-gradient(
    90deg,
    #6b7380 0%,
    #6b7380 20%,
    #9aa6b5 36%,
    #d7e0ea 46%,
    #f4f7fa 50%,
    #d7e0ea 54%,
    #9aa6b5 64%,
    #6b7380 80%,
    #6b7380 100%
  );
  background-size: 200% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: aui-title-shimmer 1.5s linear infinite;
}

@keyframes aui-title-shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -100% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .aui-title-shimmer {
    animation: none;
    background-image: none;
    background-clip: border-box;
    -webkit-background-clip: border-box;
    -webkit-text-fill-color: unset;
  }
}
</style>
