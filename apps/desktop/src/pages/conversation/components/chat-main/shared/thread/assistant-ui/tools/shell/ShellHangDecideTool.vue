<script setup lang="ts">
import { computed } from "vue";
import { TimerOffIcon } from "@lucide/vue";

import { t } from "../../../../../../../../../shared/model/ui/ui-locale";
import { mergeToolArgs } from "../shared/tool-args";
import { useToolPart } from "../shared/useToolPart";
import ToolCard from "../shared/ToolCard.vue";
import {
  shellHangDecideView,
  type ShellHangDecideOutcome,
} from "./shell-hang-decide-view";

const {
  args,
  argsText,
  resultText,
  hasResult,
  isActive,
  isError,
  isInterrupted,
} = useToolPart();

/** 流式时用 argsText 半解析补齐 hang_id / action。 */
const mergedArgs = computed(() => mergeToolArgs(args.value, argsText.value));

const view = computed(() =>
  shellHangDecideView(
    mergedArgs.value,
    hasResult.value ? resultText.value : "",
    hasResult.value,
  ),
);

const detail = computed(() => {
  if (isInterrupted.value) return t("toolTerminated");
  if (isError.value || view.value.outcome === "error") return t("toolError");
  if (view.value.outcome === "pending") {
    return actionLabel(view.value.action) || t("shellHangDecidePending");
  }
  return outcomeLabel(view.value.outcome) || actionLabel(view.value.action);
});

const showOutput = computed(() => Boolean(view.value.resultText));
const expandable = computed(
  () =>
    Boolean(view.value.hangId) ||
    Boolean(view.value.action) ||
    showOutput.value ||
    Boolean(argsText.value.trim()),
);

function actionLabel(action: string): string {
  if (action === "kill") return t("shellHangKill");
  if (action === "wait") return t("shellHangWait");
  if (action === "bg") return t("shellHangBg");
  return "";
}

function outcomeLabel(outcome: ShellHangDecideOutcome): string {
  switch (outcome) {
    case "kill":
      return t("shellHangDecideOutcomeKill");
    case "bg":
      return t("shellHangDecideOutcomeBg");
    case "wait_exited":
      return t("shellHangDecideOutcomeWaitExited");
    case "wait_idle":
      return t("shellHangDecideOutcomeWaitIdle");
    case "wait_aborted":
      return t("shellHangDecideOutcomeWaitAborted");
    case "error":
      return t("toolError");
    case "pending":
      return t("shellHangDecidePending");
    default:
      return "";
  }
}
</script>

<template>
  <!-- shell 空闲裁决：说明助手对挂起命令选了 kill / wait / bg -->
  <ToolCard
    :title="t('shellHangDecideTool')"
    :detail="detail"
    :icon="TimerOffIcon"
    :expandable="expandable"
    :prefer-open="showOutput && isActive"
  >
    <div class="flex min-w-0 flex-col gap-2 px-2.5 py-2">
      <p class="text-muted-foreground text-xs leading-snug">
        {{ t("shellHangDecideExplain") }}
      </p>
      <dl
        v-if="view.action || view.hangId"
        class="text-foreground grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs"
      >
        <dt v-if="view.action" class="text-muted-foreground shrink-0">
          {{ t("shellHangDecideAction") }}
        </dt>
        <dd v-if="view.action" class="min-w-0 font-medium">
          {{ actionLabel(view.action) }}
        </dd>
        <dt v-if="view.hangId" class="text-muted-foreground shrink-0">hang_id</dt>
        <dd
          v-if="view.hangId"
          class="min-w-0 font-mono break-all"
          :title="view.hangId"
        >
          {{ view.hangId }}
        </dd>
        <dt
          v-if="hasResult && view.outcome !== 'pending'"
          class="text-muted-foreground shrink-0"
        >
          {{ t("shellHangDecideResult") }}
        </dt>
        <dd
          v-if="hasResult && view.outcome !== 'pending'"
          class="min-w-0 font-medium"
        >
          {{ outcomeLabel(view.outcome) || t("toolResult") }}
        </dd>
      </dl>
      <pre
        v-if="showOutput"
        class="bg-paper max-h-56 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap break-all"
        :class="
          isError || view.outcome === 'error'
            ? 'text-destructive'
            : isInterrupted
              ? 'text-muted-foreground'
              : 'text-foreground'
        "
      >{{ view.resultText }}</pre>
    </div>
  </ToolCard>
</template>
