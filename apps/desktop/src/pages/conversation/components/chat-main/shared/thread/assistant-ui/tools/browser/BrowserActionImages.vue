<script setup lang="ts">
import { ref } from "vue";

import ImagePreview from "../../../../../../../../../shared/components/preview/ImagePreview.vue";
import { t } from "../../../../../../../../../shared/model/ui/ui-locale";
import type { ReadImageView } from "../files/tool-read";
import type { BrowserClickMarker } from "./browser-tool-view";

defineProps<{
  images: ReadImageView[];
  note?: string;
  /** 相对图片比例的点击准星；无则只展示截图 */
  marker?: BrowserClickMarker | null;
}>();

const previewOpen = ref(false);
const previewSrc = ref("");

function openPreview(src: string): void {
  if (!src) return;
  previewSrc.value = src;
  window.setTimeout(() => {
    previewOpen.value = true;
  }, 0);
}
</script>

<template>
  <!-- 浏览器动作截图：可叠点击准星回看 -->
  <div v-if="images.length > 0" class="flex min-w-0 flex-col gap-2 px-2.5 py-2">
    <button
      v-for="(image, index) in images"
      :key="`${image.mimeType}-${index}`"
      type="button"
      class="relative block w-fit max-w-full cursor-zoom-in rounded-md border-0 bg-transparent p-0"
      :aria-label="t('msgImagePreview')"
      @click="openPreview(image.src)"
    >
      <img
        :src="image.src"
        alt=""
        class="bg-paper max-h-72 max-w-full rounded-md object-contain ring-1 ring-border"
        draggable="false"
      />
      <!-- 首图叠准星：标「刚才点了这里」 -->
      <span
        v-if="marker && index === 0"
        class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
        :style="{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }"
        aria-hidden="true"
      >
        <span
          class="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-accent/20"
        />
        <span class="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 bg-accent" />
        <span class="absolute bottom-0 left-1/2 h-3 w-px -translate-x-1/2 bg-accent" />
        <span class="absolute left-0 top-1/2 h-px w-3 -translate-y-1/2 bg-accent" />
        <span class="absolute right-0 top-1/2 h-px w-3 -translate-y-1/2 bg-accent" />
        <span class="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
      </span>
    </button>
    <p v-if="note" class="text-muted-foreground text-xs whitespace-pre-wrap">
      {{ note }}
    </p>
    <ImagePreview v-model:open="previewOpen" :src="previewSrc" />
  </div>
</template>
