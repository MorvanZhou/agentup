<script setup lang="ts">
import { computed } from "vue";
import { ActivityIcon, Layers2Icon, SquareIcon } from "@lucide/vue";

import { argString, mergeToolArgs } from "./tool-args";
import { useToolPart } from "./useToolPart";
import ToolCard from "./ToolCard.vue";

const {
  args,
  argsText,
  toolName,
  isError,
  isInterrupted,
  resultText,
  hasResult,
  isActive,
} = useToolPart();

/** 流式时用 argsText 半解析，补齐尚未进 args 的 command / job_id。 */
const mergedArgs = computed(() => mergeToolArgs(args.value, argsText.value));

const command = computed(() => {
  const raw =
    argString(mergedArgs.value, "command") ||
    argString(mergedArgs.value, "cmd");
  return raw.replace(/\s+/g, " ").trim();
});

const jobName = computed(() => argString(mergedArgs.value, "name").trim());
const jobId = computed(() => argString(mergedArgs.value, "job_id").trim());

const title = computed(() => {
  switch (toolName.value) {
    case "bg_status":
      return "bg_status";
    case "bg_kill":
      return "bg_kill";
    default:
      return "Background Task";
  }
});

const icon = computed(() => {
  switch (toolName.value) {
    case "bg_status":
      return ActivityIcon;
    case "bg_kill":
      return SquareIcon;
    default:
      return Layers2Icon;
  }
});

const detail = computed(() => {
  if (toolName.value === "bg_status") {
    return jobId.value || "list";
  }
  if (toolName.value === "bg_kill") {
    return jobId.value;
  }
  if (jobName.value && command.value) {
    return `${jobName.value} · ${command.value}`;
  }
  return command.value || jobName.value;
});

const showCommand = computed(
  () => toolName.value === "bg_run" && Boolean(command.value),
);
const showOutput = computed(() => hasResult.value && Boolean(resultText.value));
const expandable = computed(
  () =>
    showCommand.value ||
    showOutput.value ||
    Boolean(jobId.value) ||
    Boolean(argsText.value.trim()),
);
</script>

<template>
  <!-- 后台命令：bg_run / bg_status / bg_kill -->
  <ToolCard
    :title="title"
    :detail="detail"
    :icon="icon"
    :expandable="expandable"
    :prefer-open="showOutput && isActive"
  >
    <div class="flex min-w-0 flex-col gap-2 px-2.5 py-2">
      <pre
        v-if="showCommand"
        class="bg-paper text-foreground max-h-40 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap break-all"
      ><span class="text-muted-foreground">$ </span>{{ command }}</pre>
      <pre
        v-else-if="jobId"
        class="bg-paper text-foreground max-h-40 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap break-all"
      >job_id: {{ jobId }}</pre>
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
