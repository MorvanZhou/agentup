<script setup lang="ts">
import { computed } from "vue";
import { ScanSearchIcon } from "@lucide/vue";

import { argString, shortPath } from "./tool-args";
import { useToolPart } from "./useToolPart";
import ToolCard from "./ToolCard.vue";

const { args } = useToolPart();
const detail = computed(() => {
  const pattern =
    argString(args.value, "pattern") ||
    argString(args.value, "glob") ||
    argString(args.value, "name");
  const path = argString(args.value, "path");
  if (pattern && path) return `${pattern} · ${shortPath(path)}`;
  return pattern || (path ? shortPath(path) : "");
});
</script>

<template>
  <ToolCard title="Find" :detail="detail" :icon="ScanSearchIcon" />
</template>
