<script setup lang="ts">
import AppDialog from "../../../../../shared/components/AppDialog.vue";
import { t } from "../../../../../shared/model/ui/ui-locale";

/**
 * 停止之后队列还在（docs/agent_cli §12.8.1）：问一次「还有 N 条，要继续吗」。
 * 继续 = 通知 runtime 合并队列再开一轮；清空 = 撤掉队列。
 */
const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{ count: number }>();
const emit = defineEmits<{ resume: []; clear: [] }>();
</script>

<template>
  <!-- 停止后的队列确认：继续 / 清空 -->
  <AppDialog
    :open="open"
    :title="t('followUpResumeTitle')"
    :description="t('followUpResumeBody', { n: props.count })"
    @update:open="open = $event"
  >
    <template #footer>
      <button
        type="button"
        class="min-h-8 rounded-lg border border-rule bg-paper px-3 text-sm text-muted-foreground transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/15 focus-visible:outline-none"
        @click="emit('clear')"
      >
        {{ t("followUpResumeClear") }}
      </button>
      <button
        type="button"
        class="min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition hover:bg-accent-deep focus-visible:ring-2 focus-visible:ring-accent/15 focus-visible:outline-none"
        @click="emit('resume')"
      >
        {{ t("followUpResumeContinue") }}
      </button>
    </template>
  </AppDialog>
</template>
