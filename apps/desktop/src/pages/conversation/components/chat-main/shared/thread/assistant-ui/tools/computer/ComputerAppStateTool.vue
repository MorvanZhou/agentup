<script setup lang="ts">
import { computed } from "vue";
import { AppWindowIcon } from "@lucide/vue";

import { imagesFromToolResult } from "../files/tool-read";
import { useToolPart } from "../shared/useToolPart";
import ComputerActionBody from "./ComputerActionBody.vue";
import {
  computerAppStateSummary,
  computerAxCollapsedNote,
} from "./computer-tool-view";
import ToolCard from "../shared/ToolCard.vue";

const { args, result, hasResult, isActive } = useToolPart();

/** App state = 截图 + AX；给人看图，AX 树不进气泡正文。 */
const detail = computed(() => computerAppStateSummary(args.value, result.value));
const images = computed(() => imagesFromToolResult(result.value));
const hasGraphics = computed(() => images.value.length > 0);
const fallbackText = computed(() =>
  hasGraphics.value ? "" : computerAxCollapsedNote(result.value),
);
const expandable = computed(() => hasGraphics.value || Boolean(fallbackText.value));
</script>

<template>
  <!-- Computer Use：应用状态 — 有图只回放截图；无图才给折叠短 AX -->
  <ToolCard
    title="App state"
    :detail="detail"
    :icon="AppWindowIcon"
    :expandable="expandable"
    :prefer-open="hasGraphics && (isActive || hasResult)"
  >
    <ComputerActionBody
      v-if="expandable"
      :images="images"
      :fallback-text="fallbackText"
    />
  </ToolCard>
</template>
