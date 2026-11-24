<script setup lang="ts">
import { computed } from "vue";
import { CameraIcon } from "@lucide/vue";

import { imagesFromToolResult } from "../files/tool-read";
import { useToolPart } from "../shared/useToolPart";
import { browserScreenshotSummary } from "./browser-tool-view";
import BrowserActionImages from "./BrowserActionImages.vue";
import ToolCard from "../shared/ToolCard.vue";

const { args, result, hasResult, isActive } = useToolPart();

/** Screenshot = 真截图；有图给人看图，无图只留一行说明。 */
const detail = computed(() => browserScreenshotSummary(args.value, result.value));
const images = computed(() => imagesFromToolResult(result.value));
const hasGraphics = computed(() => images.value.length > 0);
</script>

<template>
  <!-- Playwright / Browser Use：截图 → 展示图片信息 -->
  <ToolCard
    title="Screenshot"
    :detail="detail"
    :icon="CameraIcon"
    :expandable="hasGraphics"
    :prefer-open="hasGraphics && (isActive || hasResult)"
  >
    <BrowserActionImages v-if="hasGraphics" :images="images" />
  </ToolCard>
</template>
