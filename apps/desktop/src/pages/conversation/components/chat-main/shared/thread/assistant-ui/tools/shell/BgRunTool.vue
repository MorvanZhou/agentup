<script setup lang="ts">
import { computed } from "vue";
import { Layers2Icon } from "@lucide/vue";

import { t } from "../../../../../../../../../shared/model/ui/ui-locale";
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

const showMeta = computed(() => Boolean(jobName.value || command.value));
const showOutput = computed(() => hasResult.value && Boolean(resultText.value));
const expandable = computed(
  () =>
    showMeta.value ||
    showOutput.value ||
    Boolean(argsText.value.trim()),
);
</script>

<template>
  <!-- 后台长任务：立刻返回 job，不堵 turn -->
  <ToolCard
    :title="t('toolBgRun')"
    :detail="detail"
    :icon="Layers2Icon"
    :expandable="expandable"
    :prefer-open="showOutput && isActive"
  >
    <div class="flex min-w-0 flex-col gap-2 px-2.5 py-2">
      <dl v-if="showMeta" class="grid gap-1.5 text-xs">
        <div v-if="jobName" class="flex min-w-0 gap-2">
          <dt class="w-14 shrink-0 text-muted-foreground">{{ t("toolBgRunName") }}</dt>
          <dd class="min-w-0 truncate font-medium text-foreground">{{ jobName }}</dd>
        </div>
        <div v-if="command" class="flex min-w-0 gap-2">
          <dt class="w-14 shrink-0 text-muted-foreground">{{ t("toolBgRunCmd") }}</dt>
          <dd class="min-w-0 break-all font-mono text-foreground">{{ command }}</dd>
        </div>
      </dl>
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
