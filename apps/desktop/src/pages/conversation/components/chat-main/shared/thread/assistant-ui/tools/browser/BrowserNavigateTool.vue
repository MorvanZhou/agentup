<script setup lang="ts">
import { computed } from "vue";
import { GlobeIcon } from "@lucide/vue";

import { argString } from "../shared/tool-args";
import { useToolPart } from "../shared/useToolPart";
import { shortBrowserUrl } from "./browser-tool-view";
import ToolCard from "../shared/ToolCard.vue";

const {
  args,
  isError,
  isInterrupted,
  resultText,
  hasResult,
  isActive,
} = useToolPart();

const url = computed(() => argString(args.value, "url").trim());
const detail = computed(() => shortBrowserUrl(url.value));
const showOutput = computed(() => hasResult.value && Boolean(resultText.value));
</script>

<template>
  <!-- Playwright / 浏览器：打开或跳转 URL -->
  <ToolCard
    title="Navigate"
    :detail="detail"
    :icon="GlobeIcon"
    :expandable="hasResult || Boolean(url)"
    :prefer-open="showOutput && isActive"
  >
    <div class="flex min-w-0 flex-col gap-2 px-2.5 py-2">
      <p v-if="url" class="text-foreground min-w-0 truncate font-mono text-xs">{{ url }}</p>
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
