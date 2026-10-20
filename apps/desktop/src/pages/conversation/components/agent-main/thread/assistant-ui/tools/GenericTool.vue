<script setup lang="ts">
import { computed } from "vue";
import { WrenchIcon } from "@lucide/vue";

import { summarizeArgs } from "./tool-args";
import { useToolPart } from "./useToolPart";
import ToolCard from "./ToolCard.vue";

const { args, toolName } = useToolPart();
const title = computed(() => toolName.value || "Tool");
const detail = computed(() =>
  summarizeArgs(args.value, [
    "path",
    "file_path",
    "command",
    "cmd",
    "uri",
    "query",
    "pattern",
    "name",
  ]),
);
</script>

<template>
  <ToolCard :title="title" :detail="detail" :icon="WrenchIcon" />
</template>
