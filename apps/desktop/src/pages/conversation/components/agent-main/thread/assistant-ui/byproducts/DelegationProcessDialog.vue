<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { DesktopApi } from "../../../../../../../shared/api/runtime";
import AgentAvatar from "../../../../../../../shared/components/avatar/AgentAvatar.vue";
import AppDialog from "../../../../../../../shared/components/AppDialog.vue";
import { showToast } from "../../../../../../../shared/model/ui/toast";
import { t, tf } from "../../../../../../../shared/model/ui/ui-locale";
import { useDelegationProcess } from "../../../../../composables/useDelegationProcess";
import type { DelegationProcessTarget } from "../../../../../model/thread/thread-delegation";
import ReadonlyAssistantProcess from "./ReadonlyAssistantProcess.vue";

const props = defineProps<{
  open: boolean;
  target: DelegationProcessTarget | null;
  token: string;
  userId: string;
  runtimeBaseUrl?: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  cancelled: [taskId: string];
}>();

const {
  loading,
  streaming,
  error,
  messages,
  task,
  open: loadProcess,
  stop,
} = useDelegationProcess();

const api = new DesktopApi();
const cancelling = ref(false);

const agentName = computed(() => props.target?.toAgentName?.trim() || t("assistLabel"));

const title = computed(() => {
  const name = props.target?.toAgentName?.trim();
  return name ? tf("assistProcessTitle", { name }) : t("assistProcessFallback");
});

const description = computed(() => props.target?.brief?.trim() || undefined);

const canCancel = computed(() => {
  const status = task.value?.status;
  return status === "running" || status === "pending_auth" || (!status && streaming.value);
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

async function cancelTask(): Promise<void> {
  const taskId = props.target?.taskId;
  if (!taskId || cancelling.value) return;
  cancelling.value = true;
  try {
    await api.cancelDelegation(props.token, props.userId, taskId);
    showToast(tf("fleetCancelled", { name: agentName.value }), "success");
    emit("cancelled", taskId);
    // 刷新弹窗终态
    await loadProcess({
      token: props.token,
      userId: props.userId,
      taskId,
      baseUrl: props.runtimeBaseUrl,
    });
  } catch (err) {
    showToast(
      err instanceof Error && err.message ? err.message : t("fleetCancelFailed"),
      "error",
    );
  } finally {
    cancelling.value = false;
  }
}
</script>

<template>
  <!-- 委托旁路过程：流式 / 历史只读时间线；进行中可取消 -->
  <AppDialog
    :open="open"
    :title="title"
    :description="description"
    description-clamp
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
      <!-- 已有 messages 时保留过程视图，避免 loading 闸门卸掉时间线造成闪缩 -->
      <p
        v-if="loading && messages.length === 0"
        class="mb-0 text-sm text-muted-foreground"
      >
        {{ t("assistLoading") }}
      </p>
      <p
        v-else-if="error && messages.length === 0"
        class="mb-0 rounded-lg border border-destructive/20 bg-danger-soft px-3 py-2 text-sm text-destructive"
        role="alert"
      >
        {{ error }}
      </p>
      <ReadonlyAssistantProcess
        v-else-if="messages.length > 0 || (!loading && !error)"
        :messages="messages"
        :streaming="streaming"
        :agent-id="target?.toAgentId || target?.taskId || 'delegation'"
      />
      <p
        v-if="error && messages.length > 0"
        class="mb-0 rounded-lg border border-destructive/20 bg-danger-soft px-3 py-2 text-sm text-destructive"
        role="alert"
      >
        {{ error }}
      </p>
      <p
        v-if="task?.status === 'failed' && task.error"
        class="mb-0 text-xs text-destructive"
      >
        {{ task.error }}
      </p>
      <p
        v-else-if="task?.status === 'cancelled'"
        class="mb-0 text-xs text-muted-foreground"
      >
        {{ t("fleetCancelledStatus") }}
      </p>
    </div>
    <template v-if="canCancel" #footer>
      <button
        type="button"
        class="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-paper-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        @click="onOpen(false)"
      >
        {{ t("fleetClose") }}
      </button>
      <button
        type="button"
        class="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-lg bg-destructive px-3 text-sm font-medium text-white transition duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50"
        :disabled="cancelling"
        @click="cancelTask"
      >
        {{ cancelling ? t("fleetCancelling") : t("fleetCancel") }}
      </button>
    </template>
  </AppDialog>
</template>
