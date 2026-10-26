<script setup lang="ts">
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import { onBeforeUnmount, ref, watch } from "vue";

import ImagePreview from "../../../../../../../shared/components/preview/ImagePreview.vue";

/** 附件条图片缩略图（仅图、不显示文件名）；点击用 ImagePreview 放大。 */
const file = useAuiState((s) => s.attachment.file);
const contentUrl = useAuiState((s) => {
  const content = s.attachment.content;
  if (!Array.isArray(content)) return "";
  for (const part of content) {
    if (part && typeof part === "object" && "type" in part) {
      if (part.type === "image" && typeof (part as { image?: unknown }).image === "string") {
        return (part as { image: string }).image;
      }
      if (part.type === "file" && typeof (part as { url?: unknown }).url === "string") {
        return (part as { url: string }).url;
      }
      if (part.type === "file" && typeof (part as { data?: unknown }).data === "string") {
        return (part as { data: string }).data;
      }
    }
  }
  return "";
});

const previewUrl = ref("");
const previewOpen = ref(false);
let objectUrl = "";

watch(
  [file, contentUrl],
  ([nextFile, nextContent]) => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
    if (nextFile instanceof File) {
      objectUrl = URL.createObjectURL(nextFile);
      previewUrl.value = objectUrl;
      return;
    }
    previewUrl.value = nextContent || "";
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});

function openPreview(): void {
  if (!previewUrl.value) return;
  // 推迟到本次 click 冒泡结束后再挂遮罩，避免同一次点击立刻关掉
  window.setTimeout(() => {
    previewOpen.value = true;
  }, 0);
}
</script>

<template>
  <!-- 图片缩略图 + 预览 -->
  <button
    type="button"
    class="block cursor-zoom-in rounded-md border-0 bg-transparent p-0"
    :disabled="!previewUrl"
    aria-label="预览图片"
    @click="openPreview"
  >
    <img
      v-if="previewUrl"
      :src="previewUrl"
      alt=""
      class="size-12 rounded-md object-cover ring-1 ring-border"
      draggable="false"
    />
    <span
      v-else
      class="grid size-12 place-items-center rounded-md bg-muted text-xs text-muted-foreground ring-1 ring-border"
    >图</span>
  </button>
  <ImagePreview v-model:open="previewOpen" :src="previewUrl" alt="图片预览" />
</template>
