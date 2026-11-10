<script setup lang="ts">
import { computed } from "vue";
import { SearchIcon } from "@lucide/vue";

import { t } from "../../../../../../../../../shared/model/ui/ui-locale";
import { argString } from "../shared/tool-args";
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

const query = computed(() => argString(args.value, "query").trim());
const detail = computed(() => {
  if (isRunning.value) return t("toolSearching");
  if (query.value) {
    return query.value.length > 48 ? `${query.value.slice(0, 47)}…` : query.value;
  }
  return t("toolSearched");
});
const showResult = computed(() => hasResult.value && Boolean(resultText.value.trim()));
</script>

<template>
  <!-- 搜索 deferred MCP 工具（与 agent_search 对称） -->
  <ToolCard
    :title="t('toolSearchTools')"
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
