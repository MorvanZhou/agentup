<script setup lang="ts">
import { computed } from "vue";
import { FilePenLineIcon } from "@lucide/vue";

import { argString, mergeToolArgs, shortPath } from "./tool-args";
import { filePathFromArgs, splitContentLines } from "./tool-file-view";
import { useToolPart } from "./useToolPart";
import ToolCard from "./ToolCard.vue";
import ToolCodeBlock from "./ToolCodeBlock.vue";

const { args, argsText, isError, isInterrupted, resultText, hasResult } = useToolPart();

/** 流式时用 argsText 半解析，补齐尚未进 args 的 path/content。 */
const mergedArgs = computed(() => mergeToolArgs(args.value, argsText.value));
const path = computed(() => filePathFromArgs(mergedArgs.value));
const detail = computed(() => (path.value ? shortPath(path.value) : ""));
const content = computed(() => argString(mergedArgs.value, "content"));
const lineCount = computed(() => splitContentLines(content.value).length);
const showFallbackResult = computed(
  () => !content.value && hasResult.value && Boolean(resultText.value),
);
</script>

<template>
  <ToolCard
    title="Write"
    :detail="detail"
    :icon="FilePenLineIcon"
    :added="lineCount"
    :expandable="Boolean(content) || showFallbackResult"
    :prefer-open="false"
  >
    <!-- 写入内容：等宽代码块（含 argsText 流式预览） -->
    <ToolCodeBlock
      v-if="content"
      :content="content"
      :path="path"
      :start-line="1"
    />
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
