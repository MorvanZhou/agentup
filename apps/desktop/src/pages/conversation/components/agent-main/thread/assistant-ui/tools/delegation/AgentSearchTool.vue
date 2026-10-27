<script setup lang="ts">
import { computed } from "vue";
import { SearchIcon } from "@lucide/vue";

import { t } from "../../../../../../../../shared/model/ui/ui-locale";
import { argTrimmedString, clipToolDetail } from "./tool-delegate";
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

const query = computed(() => argTrimmedString(args.value, "query"));
const detail = computed(() => {
  if (isRunning.value) return t("delegateSearching");
  if (query.value) return clipToolDetail(query.value);
  return t("delegateSearched");
});
const showResult = computed(() => hasResult.value && Boolean(resultText.value.trim()));
</script>

<template>
  <!-- 搜索已招募专家 -->
  <ToolCard
    :title="t('delegateSearchAgents')"
    :detail="detail"
    :icon="SearchIcon"
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
