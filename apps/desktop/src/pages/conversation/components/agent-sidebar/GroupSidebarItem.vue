<script setup lang="ts">
import { computed } from "vue";
import { HourglassIcon, LoaderCircleIcon } from "@lucide/vue";

import { useDesktop } from "../../../../app/desktop";
import GroupAvatar from "../../../../shared/components/avatar/GroupAvatar.vue";
import { t, tf, uiLocale } from "../../../../shared/model/ui/ui-locale";
import { formatSidebarTimeLabel } from "../../model/message/message-time";
import {
  groupActivityAt,
  groupSidebarPreviewLabel,
  groupUnreadLabel,
  type GroupSidebarRow,
} from "../../model/sidebar/group-sidebar";

const props = defineProps<{
  row: GroupSidebarRow;
  /** agentId → 侧栏名片上的头像。群记录本身不存头像。 */
  avatars?: Record<string, string>;
}>();

const emit = defineEmits<{ select: [] }>();

const { session } = useDesktop();

const title = computed(() => props.row.room.title.trim() || t("groupTitle"));
const faces = computed(() =>
  (props.row.room.members ?? []).map((member) => ({
    agentId: member.agentId,
    avatarUrl: props.avatars?.[member.agentId] ?? "",
  })),
);
/** 群拼图首位用当前登录/游客头像。 */
const userAvatarUrl = computed(() => session.value?.avatarUrl ?? "");
/** 待用户操作（群 Dock 审批 / 提问）；进行中用转圈占角标，二者不同时叠红点。 */
const awaitingUser = computed(() => props.row.awaitingApproval || props.row.awaitingAskUser);
const showWorking = computed(() => props.row.working && !awaitingUser.value);
const badge = computed(() => groupUnreadLabel(props.row));
const previewLabel = computed(() => groupSidebarPreviewLabel(props.row));
/** 微信式：群名右侧显示最近一条可见消息时间。 */
const timeLabel = computed(() =>
  formatSidebarTimeLabel(groupActivityAt(props.row.room), uiLocale.value),
);
const ariaLabel = computed(() => {
  const parts = [title.value];
  if (awaitingUser.value) parts.push(previewLabel.value);
  else {
    if (showWorking.value) parts.push(t("sideWorking"));
    if (badge.value) parts.push(tf("sideUnread", { n: badge.value }));
  }
  if (timeLabel.value) parts.push(timeLabel.value);
  return parts.join("，");
});
</script>

<template>
  <!-- 群会话行：成员头像拼成一格；进行中转圈 / HITL 红点与单聊对齐 -->
  <button
    type="button"
    class="grid w-full grid-cols-[48px_minmax(0,1fr)] gap-2.5 border-0 bg-transparent px-3 py-3.5 text-left text-inherit transition duration-200 hover:bg-muted"
    :class="{ 'bg-muted!': row.selected }"
    :aria-current="row.selected ? 'true' : undefined"
    :aria-label="ariaLabel"
    @click="emit('select')"
  >
    <span class="relative size-12 shrink-0">
      <GroupAvatar :faces="faces" :user-avatar-url="userAvatarUrl" size="sidebar" />
      <span
        v-if="showWorking"
        class="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-paper text-accent shadow-sm ring-1 ring-rule"
        aria-hidden="true"
      >
        <LoaderCircleIcon class="size-3.5 animate-spin motion-reduce:animate-none" />
      </span>
      <span
        v-else-if="badge"
        class="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[11px] leading-none font-semibold text-white"
        aria-hidden="true"
      >
        {{ badge }}
      </span>
    </span>
    <span class="grid min-w-0 content-center gap-0.5 leading-snug">
      <strong class="flex min-w-0 items-baseline gap-2 text-sm font-medium text-foreground">
        <span class="min-w-0 flex-1 truncate" :title="title">{{ title }}</span>
        <time
          v-if="timeLabel"
          class="shrink-0 text-xs font-normal tabular-nums text-muted-foreground"
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
        <span class="min-w-0 truncate">{{ previewLabel }}</span>
      </span>
      <small v-else class="truncate text-xs font-normal text-muted-foreground">{{ previewLabel }}</small>
    </span>
  </button>
</template>
