<script setup lang="ts">
import { computed } from "vue";
import { PencilIcon } from "@lucide/vue";

import { injectChatSurface } from "../../../../../../../model/thread/chat-surface";
import { mergeToolArgs, shortPath } from "../shared/tool-args";
import {
  diffEditHunks,
  filePathFromArgs,
  parseEditHunks,
  summarizeDiff,
} from "./tool-file-view";
import { useToolPart } from "../shared/useToolPart";
import ToolCard from "../shared/ToolCard.vue";
import ToolDiffBlock from "./ToolDiffBlock.vue";

const { args, argsText, isError, isInterrupted, resultText, hasResult, isActive } = useToolPart();
const surface = injectChatSurface();

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
/** 群聊默认折叠，避免持有者回合里大块 diff 占屏；单聊仍边写边展开。 */
const preferOpen = computed(() => {
  if (surface.value.groupId) return false;
  return hasDiff.value || (isActive.value && Boolean(argsText.value));
});
</script>

<template>
  <ToolCard
    title="Edit"
    :detail="detail"
    :icon="PencilIcon"
    :added="stats.added"
    :removed="stats.removed"
    :expandable="hasDiff || showFallbackResult"
    :prefer-open="preferOpen"
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
