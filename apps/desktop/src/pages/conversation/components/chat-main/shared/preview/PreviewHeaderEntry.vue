<script setup lang="ts">
import { computed } from "vue";
import { PinOffIcon, PlayIcon, SquareIcon } from "@lucide/vue";

import { t } from "../../../../../../shared/model/ui/ui-locale";
import { injectThreadPreview } from "../../../../model/thread/thread-preview";

const threadPreview = injectThreadPreview();
/** 仅人侧钉过的配方才常驻顶栏 */
const first = computed(() => threadPreview?.headerRecipes.value[0] ?? null);
const busy = computed(() => threadPreview?.busy.value ?? false);
const isOpen = computed(
  () =>
    threadPreview?.open.value === true &&
    Boolean(first.value) &&
    threadPreview.active.value?.id === first.value?.id,
);

async function onToggle(): Promise<void> {
  if (!threadPreview || !first.value) return;
  if (isOpen.value) {
    await threadPreview.stop(first.value);
    return;
  }
  await threadPreview.start(first.value);
}

/** 只取消顶栏常驻；保留 workspace.json 配方与气泡脚卡 */
async function onUnpin(): Promise<void> {
  if (!threadPreview || !first.value) return;
  await threadPreview.setHeaderPinned(first.value, false);
}
</script>

<template>
  <!-- 顶栏常驻：仅 header_pinned；启停 + 取消常驻（不删配方） -->
  <div
    v-if="first"
    class="app-no-drag inline-flex min-h-8 shrink-0 items-center rounded-lg"
    role="group"
    :aria-label="t('msgPreviewHeader')"
  >
    <button
      type="button"
      class="inline-flex min-h-8 items-center gap-1.5 rounded-l-lg border-0 bg-transparent pl-2.5 pr-2 text-sm font-medium text-foreground outline-none transition duration-200 hover:bg-paper focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
      :class="isOpen ? 'bg-paper' : ''"
      :disabled="busy"
      :aria-pressed="isOpen"
      @click="onToggle"
    >
      <SquareIcon v-if="isOpen" class="size-3.5 shrink-0" aria-hidden="true" />
      <PlayIcon v-else class="size-3.5 shrink-0" aria-hidden="true" />
      <span>{{ isOpen ? t("msgPreviewStop") : t("msgPreviewStart") }}</span>
    </button>
    <button
      type="button"
      class="inline-flex size-8 items-center justify-center rounded-r-lg border-0 bg-transparent text-muted-foreground outline-none transition duration-200 hover:bg-paper hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="busy"
      :aria-label="t('msgPreviewUnpinHeader')"
      :title="t('msgPreviewUnpinHeader')"
      @click="onUnpin"
    >
      <PinOffIcon class="size-3.5" aria-hidden="true" />
    </button>
  </div>
</template>
