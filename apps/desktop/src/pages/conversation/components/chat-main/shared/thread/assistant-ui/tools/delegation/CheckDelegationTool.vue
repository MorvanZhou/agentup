<script setup lang="ts">
import { computed } from "vue";
import { ListIcon } from "@lucide/vue";

import { t, tf } from "../../../../../../../../../shared/model/ui/ui-locale";
import { checkDelegationSummary } from "./tool-delegate";
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

const summary = computed(() => checkDelegationSummary(args.value));
const detail = computed(() => {
  const { taskId, taskIdCount } = summary.value;
  if (isRunning.value) {
    if (taskIdCount > 1) return tf("delegateQueryFanout", { count: taskIdCount });
    return taskId ? tf("delegateQueryId", { id: taskId.slice(0, 8) }) : t("delegateQueryRecent");
  }
  if (taskIdCount > 1) return tf("delegateFanoutLabel", { count: taskIdCount });
  return taskId || t("delegateRecent");
});
const showResult = computed(() => hasResult.value && Boolean(resultText.value.trim()));
</script>

<template>
  <!-- 查询委托进度 -->
  <ToolCard
    :title="t('delegateCheckProgress')"
    :detail="detail"
    :icon="ListIcon"
    :expandable="showResult"
    :prefer-open="false"
  >
    <div v-if="showResult" class="min-w-0 px-2.5 py-2">
      <pre
        class="bg-paper max-h-56 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap break-words"
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
