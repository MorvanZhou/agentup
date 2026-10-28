<script setup lang="ts">
import { computed } from "vue";
import { PlugIcon } from "@lucide/vue";

import { parseMcpToolName, summarizeArgs } from "../shared/tool-args";
import { useToolPart } from "../shared/useToolPart";
import ToolCard from "../shared/ToolCard.vue";

const { args, toolName } = useToolPart();
const parsed = computed(() => parseMcpToolName(toolName.value));
const title = computed(() => parsed.value?.tool || toolName.value || "MCP");
const detail = computed(() => {
  const server = parsed.value?.server ?? "";
  const hint = summarizeArgs(args.value, [
    "uri",
    "path",
    "query",
    "name",
    "id",
    "city",
    "symbol",
  ]);
  if (server && hint) return `${server} · ${hint}`;
  return server || hint;
});
</script>

<template>
  <ToolCard :title="title" :detail="detail" :icon="PlugIcon" />
</template>
