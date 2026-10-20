<script setup lang="ts">
import { computed } from "vue";
import { TerminalIcon } from "@lucide/vue";

import { argString, mergeToolArgs } from "./tool-args";
import { useToolPart } from "./useToolPart";
import ToolCard from "./ToolCard.vue";

const {
  args,
  argsText,
  isError,
  isInterrupted,
  resultText,
  hasResult,
  isActive,
} = useToolPart();

/** 流式时用 argsText 半解析，补齐尚未进 args 的 command。 */
const mergedArgs = computed(() => mergeToolArgs(args.value, argsText.value));
const command = computed(() => {
  const raw =
    argString(mergedArgs.value, "command") ||
    argString(mergedArgs.value, "cmd") ||
    argString(mergedArgs.value, "script");
  return raw.replace(/\s+/g, " ").trim();
});
const detail = computed(() => command.value);
const showOutput = computed(() => hasResult.value && Boolean(resultText.value));
const expandable = computed(
  () => Boolean(command.value) || showOutput.value || Boolean(argsText.value.trim()),
);
</script>

<template>
  <ToolCard
    title="bash"
    :detail="detail"
    :icon="TerminalIcon"
    :expandable="expandable"
    :prefer-open="showOutput && isActive"
  >
    <!-- 终端：命令 + 标准输出 -->
    <div class="flex min-w-0 flex-col gap-2 px-2.5 py-2">
      <pre
        v-if="command"
        class="bg-paper text-foreground max-h-40 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap break-all"
      ><span class="text-muted-foreground">$ </span>{{ command }}</pre>
      <pre
        v-if="showOutput"
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
