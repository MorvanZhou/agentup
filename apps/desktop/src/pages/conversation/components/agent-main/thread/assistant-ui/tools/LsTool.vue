<script setup lang="ts">
import { computed } from "vue";
import { FolderTreeIcon } from "@lucide/vue";

import { argString, shortPath } from "./tool-args";
import { useToolPart } from "./useToolPart";
import ToolCard from "./ToolCard.vue";

const { args } = useToolPart();
const detail = computed(() => {
  const path = argString(args.value, "path") || argString(args.value, "dir");
  return path ? shortPath(path) : ".";
});
</script>

<template>
  <ToolCard title="Ls" :detail="detail" :icon="FolderTreeIcon" />
</template>
