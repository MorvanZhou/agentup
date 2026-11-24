<script setup lang="ts">
import { computed } from "vue";
import { MousePointerClickIcon } from "@lucide/vue";

import { imagesFromToolResult } from "../files/tool-read";
import { useToolPart } from "../shared/useToolPart";
import ComputerActionBody from "./ComputerActionBody.vue";
import {
  computerAxCollapsedNote,
  computerClickMarker,
  computerClickSummary,
} from "./computer-tool-view";
import ToolCard from "../shared/ToolCard.vue";

const { args, result, hasResult, isActive } = useToolPart();

/** 一条操作摘要（应用 · #index）；失败由 ToolCard 错误条承接。 */
const detail = computed(() => computerClickSummary(args.value, result.value));
const images = computed(() => imagesFromToolResult(result.value));
const marker = computed(() => computerClickMarker(args.value, result.value));
const hasGraphics = computed(() => images.value.length > 0);
const fallbackText = computed(() =>
  hasGraphics.value ? "" : computerAxCollapsedNote(result.value),
);
const expandable = computed(() => hasGraphics.value || Boolean(fallbackText.value));
</script>

<template>
  <!--
    Computer Click：有截图 → 只展示图形（可叠准星）；
    无截图 → 折叠短说明，不铺整段 AX。
  -->
  <ToolCard
    title="Click"
    :detail="detail"
    :icon="MousePointerClickIcon"
    :expandable="expandable"
    :prefer-open="hasGraphics && (isActive || hasResult)"
  >
    <ComputerActionBody
      v-if="expandable"
      :images="images"
      :marker="marker"
      :fallback-text="fallbackText"
    />
  </ToolCard>
</template>
