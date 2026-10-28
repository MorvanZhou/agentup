<script setup lang="ts">
import { computed } from "vue";
import { BotIcon } from "@lucide/vue";
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";

import AgentAvatar from "../../../../../../../../../shared/components/avatar/AgentAvatar.vue";
import { t, tf } from "../../../../../../../../../shared/model/ui/ui-locale";
import {
  parseDelegationResultText,
  parseDelegationTaskId,
} from "../../../../../../../model/message/message-assistants";
import { injectThreadDelegation } from "../../../../../../../model/thread/thread-delegation";
import {
  injectThreadRoster,
  resolveRosterAgent,
} from "../../../../../../../model/thread/thread-roster";
import {
  argTrimmedString,
  clipToolDetail,
  fanoutTaskCount,
} from "./tool-delegate";
import { useToolPart } from "../shared/useToolPart";
import ToolCard from "../shared/ToolCard.vue";

const {
  args,
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

const fanoutCount = computed(() => fanoutTaskCount(args.value));
const brief = computed(() => {
  if (fanoutCount.value > 1) {
    return tf("delegateFanoutBrief", { count: fanoutCount.value });
  }
  return argTrimmedString(args.value, "brief");
});
const agentId = computed(() => argTrimmedString(args.value, "agent_id"));

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

/** 单专家委托：摘要行用头像 + 名 + 岗。 */
const showAgentIdentity = computed(
  () => fanoutCount.value <= 1 && Boolean(agentLabel.value),
);

/** 身份条下方的状态/摘要（进行中、失败、brief 预览）。 */
const statusDetail = computed(() => {
  if (isRunning.value) return t("delegateAskingGeneric");
  if (isInterrupted.value) return t("toolTerminated");
  if (isError.value) return t("delegateFailed");
  if (brief.value) return clipToolDetail(brief.value);
  return "";
});

const detail = computed(() => {
  if (showAgentIdentity.value) {
    // 身份已在 #summary；detail 仅作 ToolCard 无 slot 时的回落。
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
  if (brief.value) return clipToolDetail(brief.value);
  return agentLabel.value || t("delegateSubtask");
});

const replyText = computed(() => {
  if (!hasResult.value) return "";
  return parsedResult.value.body || resultText.value.trim();
});

const showBrief = computed(() => Boolean(brief.value));
const showReply = computed(() => hasResult.value && Boolean(replyText.value));

const taskId = computed(() => {
  const fromStarted = toolCallId.value
    ? delegation.value.resolveTaskId(toolCallId.value)
    : undefined;
  if (fromStarted) return fromStarted;
  return parseDelegationTaskId(resultText.value);
});

const canOpenProcess = computed(() => Boolean(taskId.value));

const expandable = computed(
  () => showBrief.value || showReply.value || canOpenProcess.value,
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
  <!-- 委托专家：默认折叠；单专家时摘要行展示头像 / 名 / 岗 -->
  <ToolCard
    :title="t('delegateDefault')"
    :detail="detail"
    :icon="BotIcon"
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
            :class="
              isError
                ? 'underline decoration-destructive decoration-wavy underline-offset-[3px]'
                : isActive && 'aui-delegate-name-shimmer'
            "
          >{{ agentLabel }}</span>
          <span
            v-if="agentRole"
            class="text-muted-foreground min-w-0 flex-1 truncate text-xs font-normal"
          >{{ agentRole }}</span>
        </span>
        <span
          v-if="statusDetail"
          class="text-muted-foreground min-w-0 truncate text-xs"
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
            <p class="text-muted-foreground mb-0 min-w-0 truncate text-xs font-medium">
              <span class="text-foreground">{{ agentLabel }}</span>
              <span v-if="agentRole" class="text-muted-foreground">
                · {{ agentRole }}
              </span>
            </p>
          </template>
          <p v-else class="text-muted-foreground mb-0 text-xs font-medium">
            {{
              agentLabel
                ? tf("delegateHandTo", { name: agentLabel })
                : t("delegateHandToGeneric")
            }}
          </p>
        </div>
        <pre
          class="bg-paper text-foreground max-h-40 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap break-words"
        >{{ brief }}</pre>
      </div>
      <div v-if="showReply" class="min-w-0">
        <p class="text-muted-foreground mb-1 text-xs font-medium">
          {{ t("delegateReply") }}
        </p>
        <pre
          class="bg-paper max-h-56 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap break-words"
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
          class="border-rule bg-background text-foreground hover:bg-paper-deep focus-visible:ring-accent/30 inline-flex min-h-7 cursor-pointer items-center rounded-lg border px-2.5 text-xs font-medium transition duration-200 focus-visible:outline-none focus-visible:ring-2"
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
