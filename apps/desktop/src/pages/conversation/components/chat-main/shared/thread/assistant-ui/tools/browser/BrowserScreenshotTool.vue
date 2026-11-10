<script setup lang="ts">
import { computed } from "vue";
import { CameraIcon } from "@lucide/vue";

import { imagesFromToolResult, readImageNote } from "../files/tool-read";
import { useToolPart } from "../shared/useToolPart";
import { browserToolDetail } from "./browser-tool-view";
import ReadImages from "../files/ReadImages.vue";
import ToolCard from "../shared/ToolCard.vue";

const {
  args,
  result,
  isError,
  isInterrupted,
  resultText,
  hasResult,
  isActive,
} = useToolPart();

const detail = computed(() => browserToolDetail("browser_take_screenshot", args.value));
const images = computed(() => imagesFromToolResult(result.value));
const showText = computed(
  () => hasResult.value && Boolean(resultText.value) && images.value.length === 0,
);
const expandable = computed(() => hasResult.value);
</script>

<template>
  <!-- Playwright / 浏览器：截图（有图则缩略预览） -->
  <ToolCard
    title="Screenshot"
    :detail="detail"
    :icon="CameraIcon"
    :expandable="expandable"
    :prefer-open="hasResult && isActive"
  >
    <ReadImages
      v-if="images.length > 0"
      :images="images"
      :note="readImageNote(result)"
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
