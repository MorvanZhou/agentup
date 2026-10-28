<script setup lang="ts">
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import { onUnmounted, ref, watch } from "vue";

import { shouldDismissHitlOnStop, type ThreadStopStatus } from "../../../model/thread/hitl-dismiss";

/** 把 thread.isRunning 冒泡给会话页；停止时通知收起 HITL 浮层。 */
const emit = defineEmits<{
  change: [running: boolean];
  "dismiss-hitl": [];
}>();

const isRunning = useAuiState((state) => state.thread.isRunning);
const lastAssistantStatus = useAuiState((state): ThreadStopStatus => {
  const messages = state.thread.messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return (message.status as ThreadStopStatus) ?? undefined;
    }
  }
  return undefined;
});

const wasRunning = ref(false);

function maybeDismiss(running: boolean, status: ThreadStopStatus): void {
  if (shouldDismissHitlOnStop(wasRunning.value, running, status)) {
    emit("dismiss-hitl");
  }
}

watch(
  isRunning,
  (running) => {
    emit("change", running);
    maybeDismiss(running, lastAssistantStatus.value);
    wasRunning.value = running;
  },
  { immediate: true },
);

// 停止后 status 可能略晚于 isRunning；再跟一拍 incomplete/cancelled。
watch(lastAssistantStatus, (status) => {
  if (!isRunning.value && shouldDismissHitlOnStop(true, false, status)) {
    emit("dismiss-hitl");
  }
});

onUnmounted(() => emit("change", false));
</script>

<template>
  <!-- 无可见 UI，仅桥接 running / 停止收起 HITL -->
</template>
