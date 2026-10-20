<script setup lang="ts">
import { computed } from "vue";
import { PencilIcon } from "@lucide/vue";

import { mergeToolArgs, shortPath } from "./tool-args";
import {
  diffEditHunks,
  filePathFromArgs,
  parseEditHunks,
  summarizeDiff,
} from "./tool-file-view";
import { useToolPart } from "./useToolPart";
import ToolCard from "./ToolCard.vue";
import ToolDiffBlock from "./ToolDiffBlock.vue";

const { args, argsText, isError, isInterrupted, resultText, hasResult, isActive } = useToolPart();

const mergedArgs = computed(() => mergeToolArgs(args.value, argsText.value));
const path = computed(() => filePathFromArgs(mergedArgs.value));
const detail = computed(() => (path.value ? shortPath(path.value) : ""));
const hunks = computed(() => parseEditHunks(mergedArgs.value));
const diffLines = computed(() => diffEditHunks(hunks.value));
const stats = computed(() => summarizeDiff(diffLines.value));
const hasDiff = computed(() => diffLines.value.length > 0);
const showFallbackResult = computed(
  () => !hasDiff.value && hasResult.value && Boolean(resultText.value),
);
</script>

<template>
  <ToolCard
    title="Edit"
    :detail="detail"
    :icon="PencilIcon"
    :added="stats.added"
    :removed="stats.removed"
    :expandable="hasDiff || showFallbackResult"
    :prefer-open="hasDiff || (isActive && Boolean(argsText))"
  >
    <!-- 类 git diff：按 hunk 展示删/增行（含 argsText 流式预览） -->
    <ToolDiffBlock v-if="hasDiff" :lines="diffLines" />
    <pre
      v-else-if="showFallbackResult"
      class="bg-paper max-h-40 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre"
      :class="
        isError
          ? 'text-destructive'
          : isInterrupted
            ? 'text-muted-foreground'
            : 'text-foreground'
      "
    >{{ resultText }}</pre>
  </ToolCard>
</template>
