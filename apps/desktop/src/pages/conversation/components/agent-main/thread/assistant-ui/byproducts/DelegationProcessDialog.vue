<script setup lang="ts">
import { computed, watch } from "vue";

import AgentAvatar from "../../../../../../../shared/components/AgentAvatar.vue";
import AppDialog from "../../../../../../../shared/components/AppDialog.vue";
import { t, tf } from "../../../../../../../shared/model/ui-locale";
import { useDelegationProcess } from "../../../../../composables/useDelegationProcess";
import type { DelegationProcessTarget } from "../../../../../model/thread-delegation";
import ReadonlyAssistantProcess from "./ReadonlyAssistantProcess.vue";

const props = defineProps<{
  open: boolean;
  target: DelegationProcessTarget | null;
  token: string;
  userId: string;
  runtimeBaseUrl?: string;
}>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const {
  loading,
  streaming,
  error,
  messages,
  task,
  open: loadProcess,
  stop,
} = useDelegationProcess();

const agentName = computed(() => props.target?.toAgentName?.trim() || t("assistLabel"));

const title = computed(() => {
  const name = props.target?.toAgentName?.trim();
  return name ? tf("assistProcessTitle", { name }) : t("assistProcessFallback");
});

const description = computed(() => {
  const brief = props.target?.brief?.trim() ?? "";
  if (!brief) return undefined;
  return brief.length > 80 ? `${brief.slice(0, 79)}…` : brief;
});

watch(
  () => [props.open, props.target?.taskId, props.token, props.userId] as const,
  ([isOpen, taskId, token, userId]) => {
    if (!isOpen || !taskId || !token || !userId) {
      stop();
      return;
    }
    void loadProcess({
      token,
      userId,
      taskId,
      baseUrl: props.runtimeBaseUrl,
    });
  },
  { immediate: true },
);

function onOpen(value: boolean): void {
  emit("update:open", value);
  if (!value) stop();
}
</script>

<template>
  <!-- 委托旁路过程：流式 / 历史只读时间线 -->
  <AppDialog
    :open="open"
    :title="title"
    :description="description"
    size="lg"
    @update:open="onOpen"
  >
    <template #leading>
      <AgentAvatar
        :name="agentName"
        :avatar-url="target?.toAgentAvatarUrl"
        size="md"
        round
      />
    </template>
    <div class="flex min-h-40 min-w-0 flex-col gap-2 pb-2">
      <p v-if="loading" class="mb-0 text-sm text-muted-foreground">
        {{ t("assistLoading") }}
      </p>
      <p
        v-else-if="error"
        class="mb-0 rounded-lg border border-destructive/20 bg-danger-soft px-3 py-2 text-sm text-destructive"
        role="alert"
      >
        {{ error }}
      </p>
      <ReadonlyAssistantProcess
        v-else
        :messages="messages"
        :streaming="streaming"
        :agent-id="target?.toAgentId || target?.taskId || 'delegation'"
      />
      <p
        v-if="task?.status === 'failed' && task.error"
        class="mb-0 text-xs text-destructive"
      >
        {{ task.error }}
      </p>
    </div>
  </AppDialog>
</template>
