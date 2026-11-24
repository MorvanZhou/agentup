<script setup lang="ts">
import { computed } from "vue";
import { KeyboardIcon } from "@lucide/vue";

import { imagesFromToolResult } from "../files/tool-read";
import { useToolPart } from "../shared/useToolPart";
import ComputerActionBody from "./ComputerActionBody.vue";
import {
  computerAxCollapsedNote,
  computerClickMarker,
  computerToolDetail,
  computerToolTitle,
  resolveComputerToolName,
} from "./computer-tool-view";
import ToolCard from "../shared/ToolCard.vue";

const { args, result, toolName, hasResult, isActive } = useToolPart();

const name = computed(() => resolveComputerToolName(toolName.value) ?? "type_text");
const title = computed(() => computerToolTitle(name.value));
const detail = computed(() => computerToolDetail(name.value, args.value, result.value));
const images = computed(() => imagesFromToolResult(result.value));
const marker = computed(() => computerClickMarker(args.value, result.value));
const hasGraphics = computed(() => images.value.length > 0);
const fallbackText = computed(() =>
  hasGraphics.value ? "" : computerAxCollapsedNote(result.value),
);
const expandable = computed(() => hasGraphics.value || Boolean(fallbackText.value));
</script>

<template>
  <!-- Computer Use：打字 / 设值 / 按键（有截图可叠准星） -->
  <ToolCard
    :title="title"
    :detail="detail"
    :icon="KeyboardIcon"
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
