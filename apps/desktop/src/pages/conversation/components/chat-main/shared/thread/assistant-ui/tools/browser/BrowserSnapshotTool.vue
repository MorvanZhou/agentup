<script setup lang="ts">
import { computed } from "vue";
import { ScanSearchIcon } from "@lucide/vue";

import { useToolPart } from "../shared/useToolPart";
import { browserSnapshotSummary } from "./browser-tool-view";
import ToolCard from "../shared/ToolCard.vue";

const { args, result } = useToolPart();

/** Snapshot = 无障碍树，不是截图；给人只留标题/URL 一行，不展开 YAML。 */
const detail = computed(() => browserSnapshotSummary(args.value, result.value));
</script>

<template>
  <!-- Playwright / Browser Use：页面结构快照（给模型找 ref，非图片） -->
  <ToolCard
    title="Snapshot"
    :detail="detail"
    :icon="ScanSearchIcon"
    :expandable="false"
  />
</template>
