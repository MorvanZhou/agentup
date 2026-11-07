<script setup lang="ts">
import { computed } from "vue";

import { t, tf } from "../../model/ui/ui-locale";
import AppDialog from "../AppDialog.vue";

const open = defineModel<boolean>("open", { required: true });

const props = defineProps<{
  skillName: string;
  /** installed：编辑表单已配置；pending：待装列表；immediate：立刻安装覆盖 */
  kind: "installed" | "pending" | "immediate";
}>();

const emit = defineEmits<{
  confirm: [];
}>();

const description = computed(() => {
  if (props.kind === "pending") return tf("skillsOverwritePendingBody", { name: props.skillName });
  if (props.kind === "immediate") return tf("skillsOverwriteImmediateBody", { name: props.skillName });
  return tf("skillsOverwriteInstalledBody", { name: props.skillName });
});

function onConfirm(): void {
  emit("confirm");
  open.value = false;
}
</script>

<template>
  <AppDialog
    :open="open"
    :title="t('skillsOverwriteTitle')"
    :description="description"
    @update:open="open = $event"
  >
    <template #footer>
      <!-- 取消覆盖 -->
      <button
        type="button"
        class="min-h-8 rounded-lg border border-rule px-3 text-sm font-medium transition duration-200 hover:bg-paper-deep"
        @click="open = false"
      >
        {{ t("skillsOverwriteCancel") }}
      </button>
      <!-- 确认覆盖 -->
      <button
        type="button"
        class="min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep"
        @click="onConfirm"
      >
        {{ t("skillsOverwriteConfirm") }}
      </button>
    </template>
  </AppDialog>
</template>
