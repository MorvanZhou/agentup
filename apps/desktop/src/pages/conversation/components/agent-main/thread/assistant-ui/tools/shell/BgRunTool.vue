<script setup lang="ts">
import { computed } from "vue";
import { Layers2Icon } from "@lucide/vue";

import { argString, mergeToolArgs } from "../shared/tool-args";
import { useToolPart } from "../shared/useToolPart";
import ToolCard from "../shared/ToolCard.vue";

const {
  args,
  argsText,
  isError,
  isInterrupted,
  resultText,
  hasResult,
  isActive,
} = useToolPart();

/** 流式时用 argsText 半解析，补齐尚未进 args 的 command / name。 */
const mergedArgs = computed(() => mergeToolArgs(args.value, argsText.value));

const command = computed(() => {
  const raw =
    argString(mergedArgs.value, "command") ||
    argString(mergedArgs.value, "cmd");
  return raw.replace(/\s+/g, " ").trim();
});

const jobName = computed(() => argString(mergedArgs.value, "name").trim());

const detail = computed(() => {
  if (jobName.value && command.value) {
    return `${jobName.value} · ${command.value}`;
  }
  return command.value || jobName.value;
});

const showCommand = computed(() => Boolean(command.value));
const showOutput = computed(() => hasResult.value && Boolean(resultText.value));
const expandable = computed(
  () =>
    showCommand.value ||
    showOutput.value ||
    Boolean(argsText.value.trim()),
);
</script>

<template>
  <!-- 后台启动：像 bash，强调立刻返回的长命令 -->
  <ToolCard
    title="bg_run"
    :detail="detail"
    :icon="Layers2Icon"
    :expandable="expandable"
    :prefer-open="showOutput && isActive"
  >
    <div class="flex min-w-0 flex-col gap-2 px-2.5 py-2">
      <pre
        v-if="showCommand"
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
