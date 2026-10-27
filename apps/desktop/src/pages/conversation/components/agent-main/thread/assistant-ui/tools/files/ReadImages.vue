<script setup lang="ts">
import { ref } from "vue";

import ImagePreview from "../../../../../../../../shared/components/preview/ImagePreview.vue";
import { t } from "../../../../../../../../shared/model/ui/ui-locale";

import type { ReadImageView } from "./tool-read";

defineProps<{
  images: ReadImageView[];
  note?: string;
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
  <!-- 读图结果：缩略图，点击放大 -->
  <div v-if="images.length > 0" class="flex min-w-0 flex-col gap-2 px-2.5 py-2">
    <button
      v-for="(image, index) in images"
      :key="`${image.mimeType}-${index}`"
      type="button"
      class="block w-fit max-w-full cursor-zoom-in rounded-md border-0 bg-transparent p-0"
      :aria-label="t('msgImagePreview')"
      @click="openPreview(image.src)"
    >
      <img
        :src="image.src"
        alt=""
        class="bg-paper max-h-72 max-w-full rounded-md object-contain ring-1 ring-border"
        draggable="false"
      />
    </button>
    <p v-if="note" class="text-muted-foreground text-xs whitespace-pre-wrap">
      {{ note }}
    </p>
    <ImagePreview v-model:open="previewOpen" :src="previewSrc" />
  </div>
</template>
