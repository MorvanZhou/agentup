<script setup lang="ts">
import { computed } from "vue";
import { WrenchIcon } from "@lucide/vue";

import { summarizeGenericToolArgs } from "./tool-args";
import { useToolPart } from "./useToolPart";
import ToolCard from "./ToolCard.vue";

const { args, toolName, hasResult, argsText } = useToolPart();
const title = computed(() => toolName.value || "Tool");
/** 外部 SDK 的 ToolSearch / DeferExecuteTool 等也要有一行可读摘要，不能只剩工具名。 */
const detail = computed(() => summarizeGenericToolArgs(args.value));
/** 只收紧 GenericTool：有摘要/参数/结果就可展开，不改 Read/Bash 等专用卡的 ToolCard 默认。 */
const expandable = computed(() => {
  if (detail.value.trim()) return true;
  if (hasResult.value) return true;
  if (argsText.value.trim()) return true;
  if (args.value && typeof args.value === "object" && Object.keys(args.value as object).length > 0) {
    return true;
  }
  return undefined;
});
</script>

<template>
  <ToolCard
    :title="title"
    :detail="detail"
    :icon="WrenchIcon"
    :expandable="expandable"
  />
</template>
