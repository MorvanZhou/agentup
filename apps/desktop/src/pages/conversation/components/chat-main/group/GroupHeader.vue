<script setup lang="ts">
import { computed, ref } from "vue";
import {
  EllipsisVerticalIcon,
  FolderIcon,
  MessageSquarePlusIcon,
} from "@lucide/vue";

import { useDesktop } from "../../../../../app/desktop";
import AppDialog from "../../../../../shared/components/AppDialog.vue";
import GroupAvatar from "../../../../../shared/components/avatar/GroupAvatar.vue";
import { t } from "../../../../../shared/model/ui/ui-locale";
import { holderPhase, roomHolder, roomMembers, type GroupRoomView } from "../../../model/group/group-view";
import {
  rememberSkipClearContextConfirm,
  shouldSkipClearContextConfirm,
} from "../../../model/thread/clear-context-confirm";
import ChatHeader from "../shared/ChatHeader.vue";

const props = defineProps<{
  room: GroupRoomView;
  /** agentId → 名片头像。群记录本身不存头像。 */
  avatars?: Record<string, string>;
  workspaceOpen?: boolean;
  chatSettingsOpen?: boolean;
  clearing?: boolean;
}>();
const emit = defineEmits<{
  "toggle-workspace": [];
  "open-chat-settings": [];
  "clear-context": [];
}>();

const { session } = useDesktop();
const confirmOpen = ref(false);
const skipConfirm = ref(false);

const holder = computed(() => roomHolder(props.room));
const phase = computed(() => holderPhase(props.room));
const title = computed(() => {
  const name = typeof props.room.title === "string" ? props.room.title.trim() : "";
  return name || t("groupTitle");
});
const faces = computed(() =>
  roomMembers(props.room).map((member) => ({
    agentId: member.agentId,
    avatarUrl: props.avatars?.[member.agentId] ?? "",
  })),
);
/** 群拼图首位用当前登录/游客头像。 */
const userAvatarUrl = computed(() => session.value?.avatarUrl ?? "");
const holderStatus = computed(() => {
  if (phase.value === "speaking") return t("groupHolderSpeaking");
  if (phase.value === "waiting") return t("groupHolderWaiting");
  if (phase.value === "closing") return t("groupHolderClosing");
  return t("groupHolderIdle");
});
/** Holder 名 + 状态，作为群名下方的次要信息。 */
const subtitle = computed(() => {
  const name = holder.value?.name?.trim();
  return name ? `${name} · ${holderStatus.value}` : holderStatus.value;
});

const clearDisabled = computed(() => props.room.holderSpeaking === true || props.clearing === true);

function openClearConfirm(): void {
  if (clearDisabled.value) return;
  if (shouldSkipClearContextConfirm(session.value?.userId ?? "")) {
    emit("clear-context");
    return;
  }
  skipConfirm.value = false;
  confirmOpen.value = true;
}

function confirmClear(): void {
  if (skipConfirm.value) rememberSkipClearContextConfirm(session.value?.userId ?? "");
  confirmOpen.value = false;
  emit("clear-context");
}
</script>

<template>
  <ChatHeader>
    <template #leading>
      <GroupAvatar :faces="faces" :user-avatar-url="userAvatarUrl" />
    </template>
    <template #title>
      <h1 class="m-0 truncate text-base font-semibold tracking-tight text-foreground">{{ title }}</h1>
    </template>
    <template #subtitle>
      <p class="m-0 truncate text-xs text-muted-foreground">{{ subtitle }}</p>
    </template>
    <template #actions>
      <button
        type="button"
        class="app-no-drag inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border-0 bg-transparent px-3 text-sm font-medium text-foreground outline-none transition duration-200 hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent/40"
        :disabled="clearDisabled"
        @click="openClearConfirm"
      >
        <MessageSquarePlusIcon class="size-3.5" aria-hidden="true" />
        {{ clearing ? t("threadCreating") : t("threadNew") }}
      </button>
      <button
        type="button"
        class="app-no-drag grid size-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent outline-none transition duration-200 hover:bg-paper hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
        :class="workspaceOpen ? 'bg-paper text-foreground' : 'text-muted-foreground'"
        :aria-label="t('threadWorkspace')"
        :aria-pressed="Boolean(workspaceOpen)"
        @click="emit('toggle-workspace')"
      >
        <FolderIcon class="size-4" aria-hidden="true" />
      </button>
      <!-- 一点直进群设置（清空工作区 / 删群在设置底） -->
      <button
        type="button"
        class="app-no-drag grid size-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent outline-none transition duration-200 hover:bg-paper hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
        :class="chatSettingsOpen ? 'bg-paper text-foreground' : 'text-muted-foreground'"
        :aria-label="t('groupSettingsMenu')"
        :aria-pressed="Boolean(chatSettingsOpen)"
        @click="emit('open-chat-settings')"
      >
        <EllipsisVerticalIcon class="size-4" />
      </button>
    </template>
  </ChatHeader>
  <AppDialog
    :open="confirmOpen"
    :title="t('threadNewTitle')"
    :description="t('threadNewBody')"
    @update:open="confirmOpen = $event"
  >
    <label class="flex cursor-pointer items-center gap-2 text-sm text-foreground">
      <input
        v-model="skipConfirm"
        type="checkbox"
        class="size-4 rounded border-rule text-accent accent-accent"
      />
      <span>{{ t("threadDontAsk") }}</span>
    </label>
    <template #footer>
      <button
        type="button"
        class="min-h-8 rounded-lg border border-rule px-3 text-sm font-medium transition duration-200 hover:bg-paper-deep"
        @click="confirmOpen = false"
      >
        {{ t("cancel") }}
      </button>
      <button
        type="button"
        class="min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep"
        @click="confirmClear"
      >
        {{ t("threadNew") }}
      </button>
    </template>
  </AppDialog>
</template>
