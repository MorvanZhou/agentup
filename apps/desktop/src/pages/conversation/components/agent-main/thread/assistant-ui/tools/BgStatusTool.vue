<script setup lang="ts">
import { computed } from "vue";
import { ActivityIcon } from "@lucide/vue";

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

/** 结果里抽出 status: …，便于摘要行一眼看到 running / completed。 */
const resultStatus = computed(() => {
  if (!hasResult.value) return "";
  const match = resultText.value.match(/^status:\s*(\S+)/im);
  return match?.[1]?.trim() ?? "";
});

const detail = computed(() => {
  if (jobId.value) {
    return resultStatus.value
      ? `${jobId.value} · ${resultStatus.value}`
      : jobId.value;
  }
  if (resultStatus.value) return resultStatus.value;
  return "list";
});

const showOutput = computed(() => hasResult.value && Boolean(resultText.value));
const expandable = computed(
  () =>
    showOutput.value ||
    Boolean(jobId.value) ||
    Boolean(argsText.value.trim()),
);
</script>

<template>
  <!-- 后台状态：查单个 job 或列出近期作业 -->
  <ToolCard
    title="bg_status"
    :detail="detail"
    :icon="ActivityIcon"
    :expandable="expandable"
    :prefer-open="showOutput && isActive"
  >
    <div class="flex min-w-0 flex-col gap-2 px-2.5 py-2">
      <p
        v-if="jobId"
        class="text-muted-foreground font-mono text-xs break-all"
      >
        job_id: {{ jobId }}
      </p>
      <p
        v-else
        class="text-muted-foreground text-xs"
      >
        recent jobs
      </p>
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
