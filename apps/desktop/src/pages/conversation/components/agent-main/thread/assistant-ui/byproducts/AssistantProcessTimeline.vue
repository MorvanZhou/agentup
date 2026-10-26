<script setup lang="ts">
import { PartByIndexProvider, useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import { computed } from "vue";

import { t } from "../../../../../../../shared/model/ui/ui-locale";
import { buildAssistantTimeline } from "../../../../../model/message/assistant-process";
import { injectPendingAskUserToolCallId } from "../../../../../model/thread/thread-ask-user";
import { injectPendingApprovalToolCallId } from "../../../../../model/thread/thread-approval";
import { injectThreadAgentId } from "../../../../../model/thread/thread-agent-id";
import { isAwaitingNextStep } from "../../../../../model/message/turn-progress";
import AssistantPart from "../parts/AssistantPart.vue";
import MarkdownText from "../parts/MarkdownText.vue";
import ShimmerTitle from "../parts/ShimmerTitle.vue";
import ProcessSubgroup from "./ProcessSubgroup.vue";

withDefaults(
  defineProps<{
    /** 旁路只读时可关掉「正在计划…」与终止提示 */
    showStatus?: boolean;
  }>(),
  { showStatus: true },
);

const agentId = injectThreadAgentId();
const pendingAskUserToolCallId = injectPendingAskUserToolCallId();
const pendingApprovalToolCallId = injectPendingApprovalToolCallId();

const awaitingNextStep = useAuiState((s) =>
  isAwaitingNextStep(s.message.parts, s.message.status?.type === "running"),
);
const streaming = useAuiState((s) => s.message.status?.type === "running");
const parts = useAuiState((s) => s.message.parts);
const messageId = useAuiState((s) => s.message.id);
const messageCancelStatus = useAuiState((s) => {
  const message = s.message;
  if (message.role !== "assistant") return false;
  return message.status?.type === "incomplete" && message.status.reason === "cancelled";
});
const hasOpenAskUser = useAuiState(
  (s) =>
    s.message.role === "assistant" &&
    s.message.status?.type !== "running" &&
    s.message.parts.some(
      (part) =>
        part.type === "tool-call" &&
        part.toolName === "ask_user" &&
        part.result === undefined,
    ),
);
const error = useAuiState((s) => {
  const message = s.message;
  if (
    message.role !== "assistant" ||
    message.status.type !== "incomplete" ||
    message.status.reason !== "error"
  ) {
    return null;
  }
  const value = message.status.error;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value) {
    return String(value.message);
  }
  return t("msgError");
});

const terminated = computed(
  () =>
    messageCancelStatus.value || (hasOpenAskUser.value && !pendingAskUserToolCallId.value),
);

const timeline = computed(() =>
  buildAssistantTimeline(parts.value, {
    pendingAskUserToolCallId: pendingAskUserToolCallId.value,
    pendingApprovalToolCallId: pendingApprovalToolCallId.value,
  }),
);
</script>

<template>
  <!-- 过程时间线：与主 Agent 气泡「过程」tab 同一套 parts UI -->
  <div class="min-w-0">
    <template
      v-for="(item, itemIndex) in timeline.items"
      :key="`${item.kind}-${item.kind === 'group' ? item.id : item.index}-${itemIndex}`"
    >
      <ProcessSubgroup
        v-if="item.kind === 'group'"
        :agent-id="agentId"
        :message-id="messageId"
        :group-id="item.id"
        :indices="item.indices"
        :step-count="item.stepCount"
        :parts="parts"
        :streaming="streaming"
      />
      <PartByIndexProvider
        v-else-if="item.kind === 'text'"
        :index="item.index"
      >
        <MarkdownText />
      </PartByIndexProvider>
      <PartByIndexProvider
        v-else
        :index="item.index"
      >
        <AssistantPart />
      </PartByIndexProvider>
    </template>
    <template v-if="showStatus">
      <div v-if="awaitingNextStep && !terminated" class="mt-1">
        <ShimmerTitle :active="true" :title="t('msgPlanning')" />
      </div>
      <p
        v-if="terminated"
        class="text-muted-foreground mb-0 mt-2 text-xs"
        role="status"
      >
        {{ t("msgCancelled") }}
      </p>
      <span v-if="error" class="text-destructive text-sm">{{ error }}</span>
    </template>
  </div>
</template>
