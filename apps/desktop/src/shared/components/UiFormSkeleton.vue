<script setup lang="ts">
import { t } from "../model/ui/ui-locale";
import UiSkeleton from "./UiSkeleton.vue";

withDefaults(
  defineProps<{
    /** 字段行数（标签 + 输入骨块算一行） */
    fields?: number;
  }>(),
  { fields: 4 },
);
</script>

<template>
  <!-- 表单页加载骨架：头像位 + 若干字段行 -->
  <div class="grid gap-5" role="status" aria-busy="true" :aria-label="t('agentsLocalLoading')">
    <span class="sr-only">{{ t("agentsLocalLoading") }}</span>
    <div class="flex items-center gap-3">
      <UiSkeleton class="size-14" rounded="lg" />
      <div class="grid min-w-0 flex-1 gap-2">
        <UiSkeleton class="h-3.5 w-24" />
        <UiSkeleton class="h-8 w-36" rounded="lg" />
      </div>
    </div>
    <div v-for="index in fields" :key="index" class="grid gap-2">
      <UiSkeleton class="h-3.5 w-20" />
      <UiSkeleton class="h-8 w-full" rounded="lg" />
    </div>
  </div>
</template>
