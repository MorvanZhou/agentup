<script setup lang="ts">
import { computed } from "vue";
import { FileTextIcon } from "@lucide/vue";

import { shortPath } from "./tool-args";
import {
  filePathFromArgs,
  formatReadRange,
} from "./tool-file-view";
import { useToolPart } from "./useToolPart";
import ToolCard from "./ToolCard.vue";
import ToolCodeBlock from "./ToolCodeBlock.vue";

const { args, isError, isInterrupted, resultText, hasResult } = useToolPart();

const path = computed(() => filePathFromArgs(args.value));
const range = computed(() => formatReadRange(args.value));
const detail = computed(() => {
  if (!path.value) return range.value ? range.value.slice(1) : "";
  return `${shortPath(path.value)}${range.value}`;
});
const startLine = computed(() => {
  if (!args.value || typeof args.value !== "object") return 1;
  const offset = (args.value as { offset?: unknown }).offset;
  return typeof offset === "number" && offset > 0 ? offset : 1;
});
/** 去掉工具结果末尾的 truncation 提示行，留给代码块之外展示。 */
const contentAndNote = computed(() => {
  const raw = resultText.value;
  if (!raw) return { content: "", note: "" };
  const match = raw.match(/\n\n(\[[^\]]+\])\s*$/);
  if (!match || match.index == null) return { content: raw, note: "" };
  return {
    content: raw.slice(0, match.index),
    note: match[1] ?? "",
  };
});
const codeContent = computed(() => contentAndNote.value.content);
const note = computed(() => contentAndNote.value.note);
const showCode = computed(() => hasResult.value && Boolean(codeContent.value) && !isError.value);
</script>

<template>
  <ToolCard
    title="Read"
    :detail="detail"
    :icon="FileTextIcon"
    :expandable="hasResult"
    :prefer-open="showCode"
  >
    <!-- 读取结果：等宽代码块 -->
    <ToolCodeBlock
      v-if="showCode"
      :content="codeContent"
      :path="path"
      :start-line="startLine"
    />
    <p
      v-if="note && showCode"
      class="text-muted-foreground mt-1.5 text-xs"
    >
      {{ note }}
    </p>
    <pre
      v-else-if="hasResult && (isError || isInterrupted || !showCode)"
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
