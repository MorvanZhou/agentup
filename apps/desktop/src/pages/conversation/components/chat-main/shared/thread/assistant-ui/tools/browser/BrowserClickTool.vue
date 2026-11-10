<script setup lang="ts">
import { computed } from "vue";
import { MousePointerClickIcon } from "@lucide/vue";

import { useToolPart } from "../shared/useToolPart";
import { browserToolDetail } from "./browser-tool-view";
import ToolCard from "../shared/ToolCard.vue";

const {
  args,
  isError,
  isInterrupted,
  resultText,
  hasResult,
  isActive,
} = useToolPart();

const detail = computed(() => browserToolDetail("browser_click", args.value));
const showOutput = computed(() => hasResult.value && Boolean(resultText.value));
</script>

<template>
  <!-- Playwright / 浏览器：点击页面元素 -->
  <ToolCard
    title="Click"
    :detail="detail"
    :icon="MousePointerClickIcon"
    :expandable="hasResult"
    :prefer-open="showOutput && isActive"
  >
    <div v-if="hasResult" class="min-w-0 px-2.5 py-2">
      <pre
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
