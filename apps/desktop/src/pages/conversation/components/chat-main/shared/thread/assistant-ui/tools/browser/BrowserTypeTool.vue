<script setup lang="ts">
import { computed } from "vue";
import { KeyboardIcon } from "@lucide/vue";

import { useToolPart } from "../shared/useToolPart";
import { browserToolDetail } from "./browser-tool-view";
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

/** type / fill / fill_form 共用打字卡 */
const kind = computed(() => {
  const name = toolName.value.toLowerCase();
  if (name.includes("fill_form")) return "browser_fill_form" as const;
  if (name.includes("fill")) return "browser_fill" as const;
  return "browser_type" as const;
});
const title = computed(() =>
  kind.value === "browser_fill_form" ? "Fill form" : kind.value === "browser_fill" ? "Fill" : "Type",
);
const detail = computed(() => browserToolDetail(kind.value, args.value));
const showOutput = computed(() => hasResult.value && Boolean(resultText.value));
</script>

<template>
  <!-- Playwright / 浏览器：向可编辑元素输入 -->
  <ToolCard
    :title="title"
    :detail="detail"
    :icon="KeyboardIcon"
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
