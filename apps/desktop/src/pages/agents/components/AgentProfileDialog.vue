<script setup lang="ts">
import { computed, ref, watch } from "vue";

import AgentAvatar from "../../../shared/components/avatar/AgentAvatar.vue";
import AppDialog from "../../../shared/components/AppDialog.vue";
import ImagePreview from "../../../shared/components/preview/ImagePreview.vue";
import {
  agentDisplayName,
  agentRealNameLine,
  inferAgentProfileScene,
  type AgentProfileScene,
} from "../../../shared/components/agent/agent-profile";
import type { AgentCard } from "../../../shared/model/runtime/runtime";
import { t, tf } from "../../../shared/model/ui/ui-locale";

const props = defineProps<{
  open: boolean;
  agent: AgentCard;
  /** 显式场景；缺省按 kind / recruited 推断 */
  scene?: AgentProfileScene;
  busy?: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  recruit: [agentId: string];
  chat: [agent: AgentCard];
  edit: [agent: AgentCard];
}>();

const previewOpen = ref(false);

const displayName = computed(() => agentDisplayName(props.agent));
const realName = computed(() => agentRealNameLine(props.agent));
const roleLine = computed(() => props.agent.role?.trim() ?? "");
const resolvedScene = computed(() => inferAgentProfileScene(props.agent, props.scene));

const primaryAction = computed(() => {
  switch (resolvedScene.value) {
    case "market":
      return { id: "recruit" as const, label: props.busy ? t("agentsRecruiting") : t("agentsRecruit") };
    case "recruited":
      return { id: "chat" as const, label: t("agentsLocalChat") };
    case "local":
      return { id: "edit" as const, label: t("agentsLocalEdit") };
    case "personal":
      return { id: "edit" as const, label: t("threadAssistantSettings") };
    default:
      return null;
  }
});

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

function runPrimary(): void {
  const action = primaryAction.value;
  if (!action || props.busy) return;
  emit("update:open", false);
  if (action.id === "recruit") {
    emit("recruit", props.agent.agentId);
    return;
  }
  if (action.id === "chat") {
    emit("chat", props.agent);
    return;
  }
  emit("edit", props.agent);
}
</script>

<template>
  <!-- 资料弹窗：头像左侧；标题 remark||name，有备注另起真名；背景在下；按场景 footer CTA -->
  <AppDialog
    :open="open"
    :title="displayName"
    :description="roleLine || undefined"
    align="center"
    title-class="m-0 break-words text-lg font-semibold leading-snug tracking-tight"
    description-class="m-0 mt-1 break-words text-sm font-semibold leading-snug text-muted-foreground"
    @update:open="onDialogOpenChange"
  >
    <template #leading>
      <button
        v-if="agent.avatarUrl"
        type="button"
        class="cursor-zoom-in rounded-lg border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        :aria-label="tf('agentsAvatarPreview', { name: displayName })"
        @click="openAvatarPreview"
      >
        <AgentAvatar
          class="ring-1 ring-rule ring-offset-2 ring-offset-paper"
          :name="displayName"
          :avatar-url="agent.avatarUrl"
          size="2xl"
        />
      </button>
      <AgentAvatar
        v-else
        class="ring-1 ring-rule ring-offset-2 ring-offset-paper"
        :name="displayName"
        size="2xl"
      />
    </template>
    <!-- 有备注时在职位下方补真名 -->
    <div v-if="realName" class="pb-1">
      <p class="m-0 text-xs font-medium text-muted-foreground">{{ t("agentsProfileRealName") }}</p>
      <p class="m-0 mt-1 break-words text-sm leading-snug text-foreground">{{ realName }}</p>
    </div>
    <div v-if="filled(agent.background)" class="pb-1">
      <p class="m-0 text-xs font-medium text-muted-foreground">{{ t("agentsLocalBackground") }}</p>
      <p class="m-0 mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
        {{ agent.background }}
      </p>
    </div>
    <template v-if="primaryAction" #footer>
      <button
        type="button"
        class="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-white transition duration-150 hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="busy"
        @click="runPrimary"
      >
        {{ primaryAction.label }}
      </button>
    </template>
  </AppDialog>
  <ImagePreview
    v-model:open="previewOpen"
    :src="agent.avatarUrl || ''"
    :alt="displayName"
  />
</template>
