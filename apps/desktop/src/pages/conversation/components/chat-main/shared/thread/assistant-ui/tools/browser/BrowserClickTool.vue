<script setup lang="ts">
import { computed } from "vue";
import { MousePointerClickIcon } from "@lucide/vue";

import { imagesFromToolResult } from "../files/tool-read";
import { useToolPart } from "../shared/useToolPart";
import BrowserActionImages from "./BrowserActionImages.vue";
import { browserClickMarker, browserClickSummary } from "./browser-tool-view";
import ToolCard from "../shared/ToolCard.vue";

const { args, result, hasResult, isActive } = useToolPart();

/** 一条最相关的点击信息（元素名 / Playwright 目标）；失败时由 ToolCard 错误条承接。 */
const detail = computed(() => browserClickSummary(args.value, result.value));
const images = computed(() => imagesFromToolResult(result.value));
const marker = computed(() => browserClickMarker(args.value, result.value));
const hasGraphics = computed(() => images.value.length > 0);
</script>

<template>
  <!--
    Click：有截图 → 只展示图形（可叠准星）；
    无截图 → 不展开长文，仅摘要行一条操作信息。
  -->
  <ToolCard
    title="Click"
    :detail="detail"
    :icon="MousePointerClickIcon"
    :expandable="hasGraphics"
    :prefer-open="hasGraphics && (isActive || hasResult)"
  >
    <BrowserActionImages
      v-if="hasGraphics"
      :images="images"
      :marker="marker"
    />
  </ToolCard>
</template>
