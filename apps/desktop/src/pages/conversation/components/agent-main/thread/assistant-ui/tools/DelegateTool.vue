<script setup lang="ts">
import { computed } from "vue";
import { BotIcon, ListIcon, SearchIcon } from "@lucide/vue";
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";

import AgentAvatar from "../../../../../../../shared/components/avatar/AgentAvatar.vue";
import { t, tf } from "../../../../../../../shared/model/ui/ui-locale";
import {
  parseDelegationResultText,
  parseDelegationTaskId,
} from "../../../../../model/message/message-assistants";
import { injectThreadDelegation } from "../../../../../model/thread/thread-delegation";
import {
  injectThreadRoster,
  resolveRosterAgent,
} from "../../../../../model/thread/thread-roster";
import ToolCard from "./ToolCard.vue";
import { useToolPart } from "./useToolPart";

const {
  args,
  toolName,
  resultText,
  hasResult,
  isRunning,
  isActive,
  isError,
  isInterrupted,
} = useToolPart();

const toolCallId = useAuiState((s) =>
  s.part.type === "tool-call" ? s.part.toolCallId : "",
);
const roster = injectThreadRoster();
const delegation = injectThreadDelegation();

const isDelegate = computed(() => toolName.value === "delegate_to_agent");

const isSearchAgents = computed(() => toolName.value === "agent_search");

const title = computed(() => {
  switch (toolName.value) {
    case "agent_search":
      return t("delegateSearchAgents");
    case "check_delegation":
      return t("delegateCheckProgress");
    default:
      return t("delegateDefault");
  }
});

const icon = computed(() => {
  if (isSearchAgents.value) return SearchIcon;
  switch (toolName.value) {
    case "check_delegation":
      return ListIcon;
    default:
      return BotIcon;
  }
});

const fanoutCount = computed(() =>
  Array.isArray(args.value.tasks) ? args.value.tasks.length : 0,
);

const brief = computed(() => {
  if (fanoutCount.value > 1) {
    return tf("delegateFanoutBrief", { count: fanoutCount.value });
  }
  const raw = typeof args.value.brief === "string" ? args.value.brief.trim() : "";
  return raw;
});

const agentId = computed(() => {
  const raw = typeof args.value.agent_id === "string" ? args.value.agent_id.trim() : "";
  return raw;
});

/** 从工具结果里尽量抽出展示名与正文。 */
const parsedResult = computed(() => parseDelegationResultText(resultText.value));

const rosterCard = computed(() => {
  if (!agentId.value) return null;
  return resolveRosterAgent(roster.value, agentId.value, parsedResult.value.agentName);
});

/** 展示名：侧栏备注/名片名 → 结果里的名字；绝不回退成 agent_id。 */
const agentLabel = computed(() => {
  if (fanoutCount.value > 1) {
    return tf("delegateFanoutLabel", { count: fanoutCount.value });
  }
  if (!rosterCard.value) return parsedResult.value.agentName || "";
  const label = (
    rosterCard.value.remark ||
    rosterCard.value.name ||
    parsedResult.value.agentName
  ).trim();
  if (!label || label === agentId.value) {
    return parsedResult.value.agentName || "";
  }
  return label;
});

const agentRole = computed(() => {
  if (fanoutCount.value > 1) return "";
  return rosterCard.value?.role?.trim() || "";
});

const agentAvatarUrl = computed(() => rosterCard.value?.avatarUrl);

/** 单专家委托：摘要行用头像 + 名 + 岗，不再用纯文字「委托 Agent」。 */
const showAgentIdentity = computed(
  () => isDelegate.value && fanoutCount.value <= 1 && Boolean(agentLabel.value),
);

/** 身份条下方的状态/摘要（进行中、失败、brief 预览）。 */
const statusDetail = computed(() => {
  if (isRunning.value) return t("delegateAskingGeneric");
  if (isInterrupted.value) return t("toolTerminated");
  if (isError.value) return t("delegateFailed");
  if (brief.value) {
    return brief.value.length > 48 ? `${brief.value.slice(0, 47)}…` : brief.value;
  }
  return "";
});

const detail = computed(() => {
  if (isSearchAgents.value) {
    return isRunning.value ? t("delegateSearching") : t("delegateSearched");
  }
  if (toolName.value === "check_delegation") {
    const taskId = typeof args.value.task_id === "string" ? args.value.task_id.trim() : "";
    const taskIds = Array.isArray(args.value.task_ids) ? args.value.task_ids.length : 0;
    if (isRunning.value) {
      if (taskIds > 1) return tf("delegateQueryFanout", { count: taskIds });
      return taskId ? tf("delegateQueryId", { id: taskId.slice(0, 8) }) : t("delegateQueryRecent");
    }
    if (taskIds > 1) return tf("delegateFanoutLabel", { count: taskIds });
    return taskId || t("delegateRecent");
  }
  if (showAgentIdentity.value) {
    // 身份已在 #summary；detail 仅作 ToolCard 无 slot 时的回落（不会展示）。
    return statusDetail.value;
  }
  if (isRunning.value) {
    if (fanoutCount.value > 1) {
      return tf("delegateAskingFanout", { count: fanoutCount.value });
    }
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
  delegation.value.openProcess({
    taskId: taskId.value,
    toAgentId: agentId.value,
    toAgentName: agentLabel.value || agentId.value,
    brief: brief.value,
    toolCallId: toolCallId.value || undefined,
    toAgentAvatarUrl: agentAvatarUrl.value,
  });
}
</script>

<template>
  <!-- 委托：默认折叠；单专家时摘要行展示头像 / 名 / 岗 -->
  <ToolCard
    :title="title"
    :detail="detail"
    :icon="icon"
    :expandable="expandable"
    :prefer-open="false"
  >
    <template v-if="showAgentIdentity" #summary>
      <AgentAvatar
        :name="agentLabel"
        :avatar-url="agentAvatarUrl"
        size="sm"
        round
      />
      <span
        class="flex min-w-0 max-w-full flex-1 flex-col gap-0.5"
        :aria-busy="isActive || undefined"
        :title="
          [agentLabel, agentRole, statusDetail].filter(Boolean).join(' · ')
        "
      >
        <!-- 名 + 岗：岗不用等宽，避免像路径摘要 -->
        <span class="inline-flex min-w-0 items-baseline gap-1.5">
          <span
            class="max-w-[70%] shrink-0 truncate font-medium"
            :class="isActive && 'aui-delegate-name-shimmer'"
          >{{ agentLabel }}</span>
          <span
            v-if="agentRole"
            class="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground"
          >{{ agentRole }}</span>
        </span>
        <span
          v-if="statusDetail"
          class="min-w-0 truncate text-xs text-muted-foreground"
        >{{ statusDetail }}</span>
      </span>
    </template>

    <div class="flex min-w-0 flex-col gap-2 px-2.5 py-2">
      <div v-if="showBrief" class="min-w-0">
        <div class="mb-1 flex min-w-0 items-center gap-1.5">
          <template v-if="showAgentIdentity">
            <AgentAvatar
              :name="agentLabel"
              :avatar-url="agentAvatarUrl"
              size="xs"
              round
            />
            <p class="mb-0 min-w-0 truncate text-xs font-medium text-muted-foreground">
              <span class="text-foreground">{{ agentLabel }}</span>
              <span v-if="agentRole" class="text-muted-foreground">
                · {{ agentRole }}
              </span>
            </p>
          </template>
          <p v-else class="mb-0 text-xs font-medium text-muted-foreground">
            {{
              agentLabel
                ? tf("delegateHandTo", { name: agentLabel })
                : t("delegateHandToGeneric")
            }}
          </p>
        </div>
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

<style scoped>
/* 与 ShimmerTitle 同款扫光；委托身份条的名字在进行中扫一次 */
.aui-delegate-name-shimmer {
  background-image: linear-gradient(
    90deg,
    #6b7380 0%,
    #6b7380 20%,
    #9aa6b5 36%,
    #d7e0ea 46%,
    #f4f7fa 50%,
    #d7e0ea 54%,
    #9aa6b5 64%,
    #6b7380 80%,
    #6b7380 100%
  );
  background-size: 200% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: aui-delegate-name-shimmer 1.5s linear infinite;
}

@keyframes aui-delegate-name-shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -100% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .aui-delegate-name-shimmer {
    animation: none;
    background-image: none;
    background-clip: border-box;
    -webkit-background-clip: border-box;
    -webkit-text-fill-color: unset;
  }
}
</style>
