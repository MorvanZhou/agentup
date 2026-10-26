<script setup lang="ts">
import { ref, watch } from "vue";

import AgentAvatar from "../../../shared/components/avatar/AgentAvatar.vue";
import AppDialog from "../../../shared/components/AppDialog.vue";
import ImagePreview from "../../../shared/components/preview/ImagePreview.vue";
import type { AgentCard } from "../../../shared/model/runtime/runtime";
import { t, tf } from "../../../shared/model/ui/ui-locale";

const props = defineProps<{
  open: boolean;
  agent: AgentCard;
}>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const previewOpen = ref(false);

watch(
  () => props.open,
  (value) => {
    if (!value) previewOpen.value = false;
  },
);

function filled(value: string | undefined): string {
  return value?.trim() ?? "";
}

function openAvatarPreview(): void {
  if (!props.agent.avatarUrl) return;
  previewOpen.value = true;
}

/** 预览打开时 Dialog 若仍收到外侧关闭，只关预览、保住资料弹窗 */
function onDialogOpenChange(value: boolean): void {
  if (!value && previewOpen.value) {
    previewOpen.value = false;
    return;
  }
  emit("update:open", value);
}
</script>

<template>
  <!-- 资料弹窗：头像左侧，名称与职位在右侧；背景在下方。不含高级配置 -->
  <AppDialog
    :open="open"
    :title="agent.name"
    :description="filled(agent.role) || undefined"
    align="center"
    title-class="m-0 break-words text-lg font-semibold leading-snug tracking-tight"
    description-class="m-0 mt-1 break-words text-sm font-semibold leading-snug text-accent"
    @update:open="onDialogOpenChange"
  >
    <template #leading>
      <button
        v-if="agent.avatarUrl"
        type="button"
        class="cursor-zoom-in rounded-lg border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        :aria-label="tf('agentsAvatarPreview', { name: agent.name })"
        @click="openAvatarPreview"
      >
        <AgentAvatar
          class="ring-1 ring-rule ring-offset-2 ring-offset-paper"
          :name="agent.name"
          :avatar-url="agent.avatarUrl"
          size="2xl"
        />
      </button>
      <AgentAvatar
        v-else
        class="ring-1 ring-rule ring-offset-2 ring-offset-paper"
        :name="agent.name"
        size="2xl"
      />
    </template>
    <div v-if="filled(agent.background)" class="pb-1">
      <p class="m-0 text-xs font-medium text-muted-foreground">{{ t("agentsLocalBackground") }}</p>
      <p class="m-0 mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
        {{ agent.background }}
      </p>
    </div>
  </AppDialog>
  <ImagePreview
    v-model:open="previewOpen"
    :src="agent.avatarUrl || ''"
    :alt="agent.name"
  />
</template>
