<script setup lang="ts">
import { t } from "../../../shared/model/ui-locale";
import AgentCardSkeleton from "./AgentCardSkeleton.vue";

withDefaults(
  defineProps<{
    /** 占位卡数量；dense 默认 8，否则 6 */
    count?: number;
    /** 市场/已招募：更密多列栅格 */
    dense?: boolean;
  }>(),
  { dense: false },
);
</script>

<template>
  <!-- Agent 目录加载骨架：与正式列表同栅格 -->
  <div
    class="grid"
    :class="
      dense
        ? 'grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
        : 'gap-3 md:grid-cols-2 xl:grid-cols-3'
    "
    role="status"
    aria-busy="true"
    :aria-label="t('agentsLocalLoading')"
  >
    <span class="sr-only">{{ t("agentsLocalLoading") }}</span>
    <AgentCardSkeleton v-for="index in count ?? (dense ? 8 : 6)" :key="index" />
  </div>
</template>
