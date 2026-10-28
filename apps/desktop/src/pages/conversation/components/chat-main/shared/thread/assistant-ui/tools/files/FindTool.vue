<script setup lang="ts">
import { computed } from "vue";
import { ScanSearchIcon } from "@lucide/vue";

import { argString, shortPath } from "../shared/tool-args";
import { useToolPart } from "../shared/useToolPart";
import ToolCard from "../shared/ToolCard.vue";

const {
  args,
  isError,
  isInterrupted,
  resultText,
  hasResult,
  isActive,
} = useToolPart();

const detail = computed(() => {
  const pattern =
    argString(args.value, "pattern") ||
    argString(args.value, "glob") ||
    argString(args.value, "name");
  const path = argString(args.value, "path");
  if (pattern && path) return `${pattern} · ${shortPath(path)}`;
  return pattern || (path ? shortPath(path) : "");
});
const showOutput = computed(() => hasResult.value && Boolean(resultText.value));
</script>

<template>
  <ToolCard
    title="Find"
    :detail="detail"
    :icon="ScanSearchIcon"
    :expandable="hasResult"
    :prefer-open="showOutput && isActive"
  >
    <!-- 匹配路径列表 -->
    <div v-if="hasResult" class="min-w-0 px-2.5 py-2">
      <pre
        class="bg-paper max-h-56 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap break-all"
        :class="
          isError
            ? 'text-destructive'
            : isInterrupted
              ? 'text-muted-foreground'
              : 'text-foreground'
        "
      >{{ resultText }}</pre>
    </div>
  </ToolCard>
</template>
