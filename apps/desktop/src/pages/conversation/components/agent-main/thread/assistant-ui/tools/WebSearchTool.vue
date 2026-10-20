<script setup lang="ts">
import { computed } from "vue";
import { SearchIcon } from "@lucide/vue";

import { argString } from "./tool-args";
import { useToolPart } from "./useToolPart";
import ToolCard from "./ToolCard.vue";

const { args } = useToolPart();
const detail = computed(() => argString(args.value, "query").trim());
</script>

<template>
  <!-- 网络搜索工具卡 -->
  <ToolCard title="WebSearch" :detail="detail" :icon="SearchIcon" />
</template>
