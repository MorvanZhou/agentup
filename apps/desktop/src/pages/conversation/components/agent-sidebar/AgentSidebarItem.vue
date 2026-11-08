<script setup lang="ts">
import { computed, inject } from "vue";
import {
  CircleDotIcon,
  HourglassIcon,
  LoaderCircleIcon,
} from "@lucide/vue";

import { stubAgentCard } from "../../../../shared/components/agent/agent-profile";
import { agentProfileHostKey } from "../../../../shared/components/agent/agent-profile-host";
import AgentAvatar from "../../../../shared/components/avatar/AgentAvatar.vue";
import { t, tf, uiLocale } from "../../../../shared/model/ui/ui-locale";
import { formatSidebarTimeLabel } from "../../model/message/message-time";
import {
  attentionBadgeCount,
  conversationDisplayName,
  conversationPreviewLabel,
  delegationPreviewText,
  unreadLabel,
  type ConversationRow,
} from "../../model/sidebar/conversation-row";

const props = defineProps<{
  row: ConversationRow;
}>();

const emit = defineEmits<{ select: [] }>();
const profileHost = inject(agentProfileHostKey, null);

/** 待用户操作（本会话 Dock 或子 Agent 提醒）；进行中用转圈占角标，二者不同时叠红点。 */
const awaitingUser = computed(
  () =>
    props.row.awaitingApproval ||
    props.row.awaitingAskUser ||
    props.row.awaitingChildHitl,
);
const showWorking = computed(() => props.row.working && !awaitingUser.value);
const delegationLine = computed(() =>
  awaitingUser.value ? "" : delegationPreviewText(props.row),
);
const showIncomingMark = computed(() => !awaitingUser.value && props.row.incomingCount > 0);
const badge = computed(() =>
  showWorking.value ? "" : unreadLabel(attentionBadgeCount(props.row)),
);
const displayName = computed(() => conversationDisplayName(props.row));
const previewLabel = computed(() => conversationPreviewLabel(props.row));
/** 微信式：名称行右侧显示最近活跃时间；无消息则空。 */
const timeLabel = computed(() =>
  formatSidebarTimeLabel(props.row.lastActiveAt, uiLocale.value),
);
const awaitingLabel = computed(() => previewLabel.value);
const ariaLabel = computed(() => {
  const parts = [displayName.value];
  if (awaitingUser.value) parts.push(previewLabel.value);
  else {
    if (showWorking.value) parts.push(t("sideWorking"));
    if (delegationLine.value) parts.push(delegationLine.value);
    else if (badge.value) parts.push(tf("sideUnread", { n: badge.value }));
  }
  if (timeLabel.value) parts.push(timeLabel.value);
  return parts.join("，");
});

/** 点头像开资料，不切换当前会话 */
function openAgentProfile(): void {
  if (!profileHost) return;
  const agent = props.row.agent;
  profileHost.open({
    agent: stubAgentCard({
      agentId: agent.agentId,
      name: agent.name,
      role: agent.role,
      remark: agent.remark,
      background: agent.background,
      avatarUrl: agent.avatarUrl,
      kind: agent.kind,
      recruited: agent.recruited,
    }),
  });
}
</script>

<template>
  <!-- 会话列表项：头像单独可点开资料；更新 / 助理设置已迁到会话顶栏 -->
  <div
    class="group grid grid-cols-[auto_minmax(0,1fr)] items-stretch transition duration-200 hover:bg-muted"
    :class="{ 'bg-muted!': row.selected }"
  >
    <div class="relative flex items-center py-3.5 pl-3">
      <button
        v-if="profileHost"
        type="button"
        class="relative size-12 cursor-pointer rounded-lg border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        :aria-label="tf('agentsViewProfile', { name: displayName })"
        @click="openAgentProfile"
      >
        <AgentAvatar :name="displayName" :avatar-url="row.agent.avatarUrl" size="sidebar" />
      </button>
      <span v-else class="relative size-12">
        <AgentAvatar :name="displayName" :avatar-url="row.agent.avatarUrl" size="sidebar" />
      </span>
      <span
        v-if="showWorking"
        class="pointer-events-none absolute top-2 right-0 grid size-5 place-items-center rounded-full bg-paper text-accent shadow-sm ring-1 ring-rule"
        aria-hidden="true"
      >
        <LoaderCircleIcon class="size-3.5 animate-spin motion-reduce:animate-none" />
      </span>
      <span
        v-else-if="badge"
        class="pointer-events-none absolute top-2 right-0 grid min-h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[11px] leading-none font-semibold text-white"
        aria-hidden="true"
      >
        {{ badge }}
      </span>
    </div>
    <button
      type="button"
      class="grid min-w-0 content-center gap-0.5 border-0 bg-transparent py-2.5 pr-3 pl-2.5 text-left text-inherit leading-snug"
      :aria-label="ariaLabel"
      @click="emit('select')"
    >
      <strong class="flex min-w-0 items-baseline gap-1.5 overflow-hidden text-sm font-medium text-foreground">
        <!-- 名字优先完整显示；岗位吃剩余宽度并可截断；右侧时间对齐微信会话列表 -->
        <span class="max-w-[70%] shrink-0 truncate" :title="displayName">{{ displayName }}</span>
        <span
          v-if="row.agent.role"
          class="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground"
          :title="row.agent.role"
        >
          {{ row.agent.role }}
        </span>
        <time
          v-if="timeLabel"
          class="ml-auto shrink-0 text-xs font-normal tabular-nums text-muted-foreground"
        >
          {{ timeLabel }}
        </time>
      </strong>
      <span
        v-if="awaitingUser"
        class="inline-flex max-w-full items-center gap-1 rounded-md bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning-foreground"
        role="status"
      >
        <HourglassIcon class="size-3 shrink-0" aria-hidden="true" />
        <span class="min-w-0 truncate">{{ awaitingLabel }}</span>
      </span>
      <small
        v-else
        class="flex min-w-0 items-center gap-1 overflow-hidden text-xs"
        :class="delegationLine ? 'text-foreground' : 'text-muted-foreground'"
      >
        <CircleDotIcon
          v-if="showIncomingMark"
          class="size-3 shrink-0 text-accent"
          aria-hidden="true"
        />
        <span class="truncate">{{ previewLabel }}</span>
      </small>
    </button>
  </div>
</template>
