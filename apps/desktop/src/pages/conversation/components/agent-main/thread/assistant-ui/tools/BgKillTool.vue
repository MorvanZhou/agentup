<script setup lang="ts">
import { computed } from "vue";
import { CircleStopIcon } from "@lucide/vue";

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

const mergedArgs = computed(() => mergeToolArgs(args.value, argsText.value));
const jobId = computed(() => argString(mergedArgs.value, "job_id").trim());

const detail = computed(() => jobId.value);

const showOutput = computed(() => hasResult.value && Boolean(resultText.value));
const expandable = computed(
  () =>
    showOutput.value ||
    Boolean(jobId.value) ||
    Boolean(argsText.value.trim()),
);
</script>

<template>
  <!-- 后台停止：按 job_id 取消运行中 / 排队中的作业 -->
  <ToolCard
    title="bg_kill"
    :detail="detail"
    :icon="CircleStopIcon"
    :expandable="expandable"
    :prefer-open="showOutput && isActive"
  >
    <div class="flex min-w-0 flex-col gap-2 px-2.5 py-2">
      <pre
        v-if="jobId"
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
