<script setup lang="ts">
import { computed } from "vue";
import { SearchIcon } from "@lucide/vue";

import { argString, shortPath } from "./tool-args";
import { useToolPart } from "./useToolPart";
import ToolCard from "./ToolCard.vue";

const { args } = useToolPart();
const detail = computed(() => {
  const pattern = argString(args.value, "pattern") || argString(args.value, "query");
  const path = argString(args.value, "path") || argString(args.value, "glob");
  if (pattern && path) return `${pattern} · ${shortPath(path)}`;
  return pattern || (path ? shortPath(path) : "");
});
</script>

<template>
  <ToolCard title="Grep" :detail="detail" :icon="SearchIcon" />
</template>
