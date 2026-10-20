<script setup lang="ts">
import { computed } from "vue";
import { BotIcon, ListIcon, SearchIcon } from "@lucide/vue";
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";

import { t, tf } from "../../../../../../../shared/model/ui-locale";
import {
  parseDelegationResultText,
  parseDelegationTaskId,
} from "../../../../../model/message-assistants";
import { injectThreadDelegation } from "../../../../../model/thread-delegation";
import {
  injectThreadRoster,
  resolveRosterAgent,
} from "../../../../../model/thread-roster";
import ToolCard from "./ToolCard.vue";
import { useToolPart } from "./useToolPart";

const {
  args,
  toolName,
  resultText,
  hasResult,
  isRunning,
  isError,
  isInterrupted,
} = useToolPart();

const toolCallId = useAuiState((s) =>
  s.part.type === "tool-call" ? s.part.toolCallId : "",
);
const roster = injectThreadRoster();
const delegation = injectThreadDelegation();

const isDelegate = computed(() => toolName.value === "delegate_to_agent");

const title = computed(() => {
  switch (toolName.value) {
    case "list_recruited_agents":
      return t("delegateListAgents");
    case "check_delegation":
      return t("delegateCheckProgress");
    default:
      return t("delegateDefault");
  }
});

const icon = computed(() => {
  switch (toolName.value) {
    case "list_recruited_agents":
      return ListIcon;
    case "check_delegation":
      return SearchIcon;
    default:
      return BotIcon;
  }
});

const brief = computed(() => {
  const raw = typeof args.value.brief === "string" ? args.value.brief.trim() : "";
  return raw;
});

const agentId = computed(() => {
  const raw = typeof args.value.agent_id === "string" ? args.value.agent_id.trim() : "";
  return raw;
});

/** 从工具结果里尽量抽出展示名与正文。 */
const parsedResult = computed(() => parseDelegationResultText(resultText.value));

/** 展示名：侧栏备注/名片名 → 结果里的名字；绝不回退成 agent_id。 */
const agentLabel = computed(() => {
  if (!agentId.value) return parsedResult.value.agentName || "";
  const card = resolveRosterAgent(roster.value, agentId.value, parsedResult.value.agentName);
  const label = (card.remark || card.name || parsedResult.value.agentName).trim();
  if (!label || label === agentId.value) {
    return parsedResult.value.agentName || "";
  }
  return label;
});

const detail = computed(() => {
  if (toolName.value === "list_recruited_agents") {
    return isRunning.value ? t("delegateListing") : t("delegateListed");
  }
  if (toolName.value === "check_delegation") {
    const taskId = typeof args.value.task_id === "string" ? args.value.task_id.trim() : "";
    if (isRunning.value) {
      return taskId ? tf("delegateQueryId", { id: taskId.slice(0, 8) }) : t("delegateQueryRecent");
    }
    return taskId || t("delegateRecent");
  }
  if (isRunning.value) {
    return agentLabel.value
      ? tf("delegateAsking", { name: agentLabel.value })
      : t("delegateAskingGeneric");
  }
  if (isInterrupted.value) return t("toolTerminated");
  if (isError.value) return t("delegateFailed");
  if (brief.value) {
    return brief.value.length > 48 ? `${brief.value.slice(0, 47)}…` : brief.value;
  }
  return agentLabel.value || t("delegateSubtask");
});

const replyText = computed(() => {
  if (!hasResult.value) return "";
  if (isDelegate.value && parsedResult.value.body) return parsedResult.value.body;
  return resultText.value.trim();
});

const showBrief = computed(() => isDelegate.value && Boolean(brief.value));
const showReply = computed(() => hasResult.value && Boolean(replyText.value));

const taskId = computed(() => {
  if (!isDelegate.value) return "";
  const fromStarted = toolCallId.value
    ? delegation.value.resolveTaskId(toolCallId.value)
    : undefined;
  if (fromStarted) return fromStarted;
  return parseDelegationTaskId(resultText.value);
});

const canOpenProcess = computed(() => isDelegate.value && Boolean(taskId.value));

const expandable = computed(
  () =>
    showBrief.value ||
    showReply.value ||
    canOpenProcess.value ||
    (!isDelegate.value && hasResult.value),
);

function openProcess(): void {
  if (!taskId.value) return;
  const card = agentId.value
    ? resolveRosterAgent(roster.value, agentId.value, parsedResult.value.agentName)
    : undefined;
  delegation.value.openProcess({
    taskId: taskId.value,
    toAgentId: agentId.value,
    toAgentName: agentLabel.value || agentId.value,
    brief: brief.value,
    toolCallId: toolCallId.value || undefined,
    toAgentAvatarUrl: card?.avatarUrl,
  });
}
</script>

<template>
  <!-- 委托：默认折叠；展开后展示 brief 与对方返回 -->
  <ToolCard
    :title="title"
    :detail="detail"
    :icon="icon"
    :expandable="expandable"
    :prefer-open="false"
  >
    <div class="flex min-w-0 flex-col gap-2 px-2.5 py-2">
      <div v-if="showBrief" class="min-w-0">
        <p class="mb-1 text-xs font-medium text-muted-foreground">
          {{ agentLabel ? tf("delegateHandTo", { name: agentLabel }) : t("delegateHandToGeneric") }}
        </p>
        <pre
          class="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-paper p-2 text-xs text-foreground"
        >{{ brief }}</pre>
      </div>
      <div v-if="showReply" class="min-w-0">
        <p class="mb-1 text-xs font-medium text-muted-foreground">
          {{ isDelegate ? t("delegateReply") : t("delegateResult") }}
        </p>
        <pre
          class="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-paper p-2 text-xs"
          :class="
            isError
              ? 'text-destructive'
              : isInterrupted
                ? 'text-muted-foreground'
                : 'text-foreground'
          "
        >{{ replyText }}</pre>
      </div>
      <div v-if="canOpenProcess" class="min-w-0">
        <button
          type="button"
          class="inline-flex min-h-7 cursor-pointer items-center rounded-lg border border-rule bg-background px-2.5 text-xs font-medium text-foreground transition duration-200 hover:bg-paper-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          @click="openProcess"
        >
          {{ t("delegateSeeProcess") }}
        </button>
      </div>
    </div>
  </ToolCard>
</template>
