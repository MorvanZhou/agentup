<script setup lang="ts">
import { computed } from "vue";
import { AppWindowIcon } from "@lucide/vue";

import { useToolPart } from "../shared/useToolPart";
import {
  browserToolDetail,
  browserToolTitle,
  resolveBrowserToolName,
} from "./browser-tool-view";
import ToolCard from "../shared/ToolCard.vue";

const {
  args,
  toolName,
  isError,
  isInterrupted,
  resultText,
  hasResult,
  isActive,
} = useToolPart();

const name = computed(() => resolveBrowserToolName(toolName.value) ?? "browser");
const title = computed(() => browserToolTitle(name.value));
const detail = computed(() => browserToolDetail(name.value, args.value));
const showOutput = computed(() => hasResult.value && Boolean(resultText.value));
</script>

<template>
  <!-- Playwright / 浏览器：其余 browser_* 通用卡 -->
  <ToolCard
    :title="title"
    :detail="detail"
    :icon="AppWindowIcon"
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
