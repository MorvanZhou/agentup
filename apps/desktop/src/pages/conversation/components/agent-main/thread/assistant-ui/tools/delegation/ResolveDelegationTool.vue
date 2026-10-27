<script setup lang="ts">
import { computed } from "vue";
import { GitBranchIcon } from "@lucide/vue";

import { t } from "../../../../../../../../shared/model/ui/ui-locale";
import {
  argTrimmedString,
  clipToolDetail,
  resolveActionFromArgs,
  steerNoteFromArgs,
} from "./tool-delegate";
import { useToolPart } from "../shared/useToolPart";
import ToolCard from "../shared/ToolCard.vue";

const {
  args,
  resultText,
  hasResult,
  isRunning,
  isError,
  isInterrupted,
} = useToolPart();

const action = computed(() => resolveActionFromArgs(args.value));
const note = computed(() => steerNoteFromArgs(args.value));
const reason = computed(() => argTrimmedString(args.value, "reason"));
const taskId = computed(() => argTrimmedString(args.value, "task_id"));

const detail = computed(() => {
  if (isRunning.value) return t("delegateSteering");
  if (isInterrupted.value) return t("toolTerminated");
  if (isError.value) return t("delegateFailed");
  if (action.value === "steer" && note.value) return clipToolDetail(note.value);
  if (reason.value) return clipToolDetail(reason.value);
  if (action.value) return action.value;
  return taskId.value ? taskId.value.slice(0, 8) : "";
});

const showResult = computed(() => hasResult.value && Boolean(resultText.value.trim()));
const expandable = computed(
  () => Boolean(note.value) || Boolean(reason.value) || showResult.value,
);
</script>

<template>
  <!-- 本回合对进行中委托的处置 -->
  <ToolCard
    :title="t('delegateResolve')"
    :detail="detail"
    :icon="GitBranchIcon"
    :expandable="expandable"
    :prefer-open="false"
  >
    <div v-if="expandable" class="flex min-w-0 flex-col gap-2 px-2.5 py-2">
      <pre
        v-if="note"
        class="bg-paper text-foreground max-h-40 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap break-words"
      >{{ note }}</pre>
      <pre
        v-else-if="reason"
        class="bg-paper text-foreground max-h-40 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap break-words"
      >{{ reason }}</pre>
      <div v-if="showResult" class="min-w-0">
        <p class="text-muted-foreground mb-1 text-xs font-medium">
          {{ t("delegateResult") }}
        </p>
        <pre
          class="bg-paper max-h-56 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap break-words"
          :class="
            isError
              ? 'text-destructive'
              : isInterrupted
                ? 'text-muted-foreground'
                : 'text-foreground'
          "
        >{{ resultText }}</pre>
      </div>
    </div>
  </ToolCard>
</template>
