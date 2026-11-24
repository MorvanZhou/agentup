<script setup lang="ts">
import { computed } from "vue";
import { MonitorIcon } from "@lucide/vue";

import { imagesFromToolResult } from "../files/tool-read";
import { useToolPart } from "../shared/useToolPart";
import ComputerActionBody from "./ComputerActionBody.vue";
import {
  computerAxCollapsedNote,
  computerToolDetail,
  computerToolTitle,
  resolveComputerToolName,
} from "./computer-tool-view";
import ToolCard from "../shared/ToolCard.vue";

const { args, result, toolName, hasResult, isActive } = useToolPart();

const name = computed(() => resolveComputerToolName(toolName.value) ?? "computer");
const title = computed(() => computerToolTitle(name.value));
const detail = computed(() => computerToolDetail(name.value, args.value, result.value));
const images = computed(() => imagesFromToolResult(result.value));
const hasGraphics = computed(() => images.value.length > 0);
const fallbackText = computed(() =>
  hasGraphics.value ? "" : computerAxCollapsedNote(result.value),
);
const expandable = computed(() => hasGraphics.value || Boolean(fallbackText.value));
</script>

<template>
  <!-- Computer Use：其余工具通用卡（list_apps / scroll / drag …） -->
  <ToolCard
    :title="title"
    :detail="detail"
    :icon="MonitorIcon"
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
