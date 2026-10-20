<script setup lang="ts">
import { computed } from "vue";
import { GlobeIcon } from "@lucide/vue";

import { argString } from "./tool-args";
import { useToolPart } from "./useToolPart";
import ToolCard from "./ToolCard.vue";

const { args } = useToolPart();
const detail = computed(() => {
  const url = argString(args.value, "url").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
  } catch {
    return url;
  }
});
</script>

<template>
  <ToolCard title="WebFetch" :detail="detail" :icon="GlobeIcon" />
</template>
