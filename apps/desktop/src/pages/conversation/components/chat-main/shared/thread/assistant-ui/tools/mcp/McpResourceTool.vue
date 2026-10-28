<script setup lang="ts">
import { computed } from "vue";
import { LibraryIcon } from "@lucide/vue";

import { summarizeArgs } from "../shared/tool-args";
import { useToolPart } from "../shared/useToolPart";
import ToolCard from "../shared/ToolCard.vue";

const TITLES: Record<string, string> = {
  list_mcp_resources: "List resources",
  list_mcp_resource_templates: "List templates",
  read_mcp_resource: "Read resource",
};

const { args, toolName } = useToolPart();
const title = computed(() => TITLES[toolName.value] ?? toolName.value);
const detail = computed(() => summarizeArgs(args.value, ["server", "uri", "cursor"]));
</script>

<template>
  <ToolCard :title="title" :detail="detail" :icon="LibraryIcon" />
</template>
