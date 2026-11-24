<script setup lang="ts">
import { computed } from "vue";
import { KeyboardIcon } from "@lucide/vue";

import { imagesFromToolResult, readImageNote } from "../files/tool-read";
import { useToolPart } from "../shared/useToolPart";
import BrowserActionImages from "./BrowserActionImages.vue";
import { browserClickMarker, browserToolDetail } from "./browser-tool-view";
import ToolCard from "../shared/ToolCard.vue";

const {
  args,
  result,
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
const images = computed(() => imagesFromToolResult(result.value));
const marker = computed(() => browserClickMarker(args.value, result.value));
const showText = computed(
  () => hasResult.value && Boolean(resultText.value) && images.value.length === 0,
);
</script>

<template>
  <!-- Playwright / Browser Use：输入（有截图可叠准星） -->
  <ToolCard
    :title="title"
    :detail="detail"
    :icon="KeyboardIcon"
    :expandable="hasResult"
    :prefer-open="images.length > 0 || (showText && isActive)"
  >
    <BrowserActionImages
      v-if="images.length > 0"
      :images="images"
      :note="readImageNote(result)"
      :marker="marker"
    />
    <div v-else-if="showText" class="min-w-0 px-2.5 py-2">
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
