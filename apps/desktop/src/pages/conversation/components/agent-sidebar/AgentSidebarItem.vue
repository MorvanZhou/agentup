<script setup lang="ts">
import { computed } from "vue";
import {
  CircleDotIcon,
  EllipsisVerticalIcon,
  HourglassIcon,
  LoaderCircleIcon,
  SettingsIcon,
} from "@lucide/vue";
import { useRouter } from "vue-router";

import AgentAvatar from "../../../../shared/components/avatar/AgentAvatar.vue";
import AppDropdownMenu, { type AppDropdownItem } from "../../../../shared/components/AppDropdownMenu.vue";
import { t, tf } from "../../../../shared/model/ui/ui-locale";
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

const emit = defineEmits<{ select: []; start: [] }>();
const router = useRouter();

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
const personal = computed(() => props.row.agent.kind === "personal");
const awaitingLabel = computed(() => previewLabel.value);
const ariaLabel = computed(() => {
  const parts = [displayName.value];
  if (awaitingUser.value) parts.push(previewLabel.value);
  else {
    if (showWorking.value) parts.push(t("sideWorking"));
    if (delegationLine.value) parts.push(delegationLine.value);
    else if (badge.value) parts.push(tf("sideUnread", { n: badge.value }));
  }
  return parts.join("，");
});

const actionItems = computed((): AppDropdownItem[] =>
  personal.value
    ? [
        {
          id: "assistant-settings",
          label: t("threadAssistantSettings"),
          icon: SettingsIcon,
        },
      ]
    : [
        {
          id: "start",
          label: props.row.busy ? t("sidePreparing") : t("sideUpdate"),
          disabled: props.row.busy || !props.row.hasUpdate,
          dot: props.row.hasUpdate && !props.row.busy,
        },
      ],
);

function onAction(id: string): void {
  if (id === "assistant-settings") {
    void router.push({ name: "agents-assistant" });
    return;
  }
  if (id === "start") emit("start");
}
</script>

<template>
  <!-- 会话列表项 -->
  <div
    class="group grid grid-cols-[minmax(0,1fr)_auto] items-stretch transition duration-200 hover:bg-accent/8"
    :class="{ 'bg-accent/12!': row.selected }"
  >
    <button
      type="button"
      class="grid min-w-0 grid-cols-[48px_minmax(0,1fr)] gap-2.5 border-0 bg-transparent px-3 py-2.5 text-left text-inherit"
      :aria-label="ariaLabel"
      @click="emit('select')"
    >
      <span class="relative size-12 shrink-0">
        <AgentAvatar :name="displayName" :avatar-url="row.agent.avatarUrl" size="sidebar" />
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
        <strong class="flex min-w-0 items-baseline gap-1.5 overflow-hidden text-sm font-medium text-foreground">
          <!-- 名字优先完整显示；岗位吃剩余宽度并可截断 -->
          <span class="max-w-[70%] shrink-0 truncate" :title="displayName">{{ displayName }}</span>
          <span
            v-if="row.agent.role"
            class="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground"
            :title="row.agent.role"
          >
            {{ row.agent.role }}
          </span>
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
      </span>
    </button>
    <AppDropdownMenu :items="actionItems" @select="onAction">
      <template #trigger>
        <button
          type="button"
          class="relative mr-1.5 grid size-7 shrink-0 place-self-center place-items-center rounded-md border-0 bg-transparent text-muted-foreground outline-none transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 max-[729px]:opacity-100 min-[730px]:opacity-0 min-[730px]:group-hover:opacity-100 min-[730px]:focus-visible:opacity-100"
          :class="{ 'min-[730px]:opacity-100!': row.hasUpdate || personal }"
          :aria-label="
            row.hasUpdate
              ? tf('sideMoreUpdate', { name: displayName })
              : tf('sideMore', { name: displayName })
          "
        >
          <EllipsisVerticalIcon class="size-3.5" />
          <span
            v-if="row.hasUpdate"
            class="absolute top-1 right-1 size-1.5 rounded-full bg-destructive"
            aria-hidden="true"
          />
        </button>
      </template>
    </AppDropdownMenu>
  </div>
</template>
