<script setup lang="ts">
import type { ReadImageView } from "../files/tool-read";
import type { ComputerClickMarker } from "./computer-tool-view";
import BrowserActionImages from "../browser/BrowserActionImages.vue";

defineProps<{
  images: ReadImageView[];
  /** 有图时一般不传（避免 AX 树铺在截图下） */
  note?: string;
  marker?: ComputerClickMarker | null;
  /** 无图时的折叠说明（短 AX / 错误） */
  fallbackText?: string;
}>();
</script>

<template>
  <!-- Computer Use 动作回放：截图优先；无图才给折叠短文 -->
  <BrowserActionImages
    v-if="images.length > 0"
    :images="images"
    :note="note"
    :marker="marker"
  />
  <div v-else-if="fallbackText" class="min-w-0 px-2.5 py-2">
    <pre
      class="bg-paper max-h-24 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap break-all text-muted-foreground"
    >{{ fallbackText }}</pre>
  </div>
</template>
