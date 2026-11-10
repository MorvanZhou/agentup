<script setup lang="ts">
import { computed } from "vue";

import AppDialog from "../../../../../../shared/components/AppDialog.vue";
import { t } from "../../../../../../shared/model/ui/ui-locale";
import { injectThreadPreview } from "../../../../model/thread/thread-preview";

const threadPreview = injectThreadPreview();
const open = computed({
  get: () => threadPreview?.portConflict.value != null,
  set: (value: boolean) => {
    if (!value) threadPreview?.dismissPortConflict();
  },
});
const conflict = computed(() => threadPreview?.portConflict.value ?? null);
const busy = computed(() => threadPreview?.busy.value ?? false);

const description = computed(() => {
  const item = conflict.value;
  if (!item) return "";
  return t("msgPreviewPortConflictBody", {
    pid: String(item.pid),
    url: item.preview_url,
  });
});

async function onConfirm(): Promise<void> {
  await threadPreview?.confirmPortConflict();
}
</script>

<template>
  <!-- 预览端口被其它进程占用：确认是否结束该进程并重启 -->
  <AppDialog
    v-model:open="open"
    :title="t('msgPreviewPortConflictTitle')"
    :description="description"
  >
    <template #footer>
      <button
        type="button"
        class="min-h-8 rounded-lg border border-rule px-3 text-sm font-medium transition duration-200 hover:bg-paper-deep"
        :disabled="busy"
        @click="open = false"
      >
        {{ t("msgPreviewPortConflictCancel") }}
      </button>
      <button
        type="button"
        class="min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="busy"
        @click="onConfirm"
      >
        {{ t("msgPreviewPortConflictConfirm") }}
      </button>
    </template>
  </AppDialog>
</template>
