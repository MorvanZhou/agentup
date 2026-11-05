<script setup lang="ts">
import {
  CheckIcon,
  ChevronDownIcon,
  FolderXIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "@lucide/vue";
import { computed, inject, ref, watch } from "vue";

import type { GroupMember } from "../../../../../shared/api/runtime/groups";
import AppDialog from "../../../../../shared/components/AppDialog.vue";
import AppDropdownMenu, {
  type AppDropdownItem,
} from "../../../../../shared/components/AppDropdownMenu.vue";
import { stubAgentCard } from "../../../../../shared/components/agent/agent-profile";
import { agentProfileHostKey } from "../../../../../shared/components/agent/agent-profile-host";
import AgentAvatar from "../../../../../shared/components/avatar/AgentAvatar.vue";
import type { AgentCard } from "../../../../../shared/model/runtime/runtime";
import { showToast } from "../../../../../shared/model/ui/toast";
import { t, tf } from "../../../../../shared/model/ui/ui-locale";
import { GROUP_MEMBER_MAX, GROUP_MEMBER_MIN } from "../../../model/group/group-limits";
import SettingsDrawerFrame from "../shared/settings/SettingsDrawerFrame.vue";

const profileHost = inject(agentProfileHostKey, null);

const props = defineProps<{
  title: string;
  members: GroupMember[];
  /** 尚无执掌者且未 @ 时首启的默认应答者。 */
  defaultHolderId: string;
  agents: AgentCard[];
  avatars?: Record<string, string>;
  busy?: boolean;
  deleting?: boolean;
  clearingWorkspace?: boolean;
  renameTitle: (title: string) => Promise<void>;
  setMembers: (members: GroupMember[], defaultHolderId?: string) => Promise<void>;
  clearWorkspace?: (includeWork: boolean) => Promise<void>;
  deleteGroup?: () => Promise<void>;
}>();

const emit = defineEmits<{
  close: [];
}>();

const draft = ref("");
const savingTitle = ref(false);
const savingMembers = ref(false);
const query = ref("");
/** − 删除模式：点成员勾选待删，确认后提交。 */
const removing = ref(false);
const removePicked = ref<string[]>([]);
/** + 加人面板。 */
const adding = ref(false);
const addQuery = ref("");
const addPicked = ref<string[]>([]);

watch(
  () => props.title,
  (value) => {
    if (!savingTitle.value) draft.value = value;
  },
  { immediate: true },
);

watch(adding, (open) => {
  if (!open) {
    addQuery.value = "";
    addPicked.value = [];
  }
});

watch(removing, (open) => {
  if (!open) removePicked.value = [];
});

const memberIds = computed(() => new Set(props.members.map((m) => m.agentId)));

const filteredMembers = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.members;
  return props.members.filter((member) => memberSearchText(member).includes(q));
});

const atMemberCap = computed(() => props.members.length >= GROUP_MEMBER_MAX);
const atMemberFloor = computed(() => props.members.length <= GROUP_MEMBER_MIN);
const membersLocked = computed(
  () => props.busy === true || savingMembers.value,
);
const remainingAfterRemove = computed(
  () => props.members.length - removePicked.value.length,
);

const candidates = computed(() => {
  const q = addQuery.value.trim().toLowerCase();
  return props.agents.filter((agent) => {
    if (memberIds.value.has(agent.agentId)) return false;
    if (!q) return true;
    return agentSearchText(agent).includes(q);
  });
});

function memberSearchText(member: GroupMember): string {
  return `${member.name}\n${memberRole(member.agentId)}\n${member.agentId}`.toLowerCase();
}

function agentSearchText(agent: AgentCard): string {
  return `${agent.remark}\n${agent.name}\n${agent.role}\n${agent.agentId}`.toLowerCase();
}

function agentLabel(agent: AgentCard): string {
  return (agent.remark || agent.name || agent.agentId).trim() || agent.agentId;
}

function memberAvatar(agentId: string): string {
  return props.avatars?.[agentId] ?? "";
}

/** 岗位取自本机名单；群记录本身不存 role。 */
function memberRole(agentId: string): string {
  return props.agents.find((agent) => agent.agentId === agentId)?.role?.trim() ?? "";
}

async function saveTitle(): Promise<void> {
  if (savingTitle.value) return;
  const next = draft.value.trim();
  const current = props.title.trim();
  if (next === current) return;
  savingTitle.value = true;
  try {
    await props.renameTitle(draft.value);
  } catch (error) {
    showToast(
      error instanceof Error && error.message ? error.message : t("groupTitleFailed"),
      "error",
    );
  } finally {
    savingTitle.value = false;
    draft.value = props.title;
  }
}

async function commitMembers(
  next: GroupMember[],
  nextDefaultHolderId?: string,
): Promise<void> {
  if (savingMembers.value) return;
  if (next.length < GROUP_MEMBER_MIN || next.length > GROUP_MEMBER_MAX) {
    showToast(tf("groupNeedMembers", { min: GROUP_MEMBER_MIN, max: GROUP_MEMBER_MAX }), "error");
    return;
  }
  savingMembers.value = true;
  try {
    // 默认应答者被移出时先回落到新名单首位，再交给 runtime 校验
    const preferred =
      nextDefaultHolderId ??
      (next.some((member) => member.agentId === props.defaultHolderId)
        ? props.defaultHolderId
        : next[0]?.agentId);
    await props.setMembers(next, preferred);
  } catch (error) {
    showToast(
      error instanceof Error && error.message ? error.message : t("groupMembersFailed"),
      "error",
    );
  } finally {
    savingMembers.value = false;
  }
}

const defaultHolderMember = computed(
  () =>
    props.members.find((member) => member.agentId === props.defaultHolderId) ??
    props.members[0] ??
    null,
);

const defaultHolderItems = computed((): AppDropdownItem[] =>
  props.members.map((member) => ({
    id: member.agentId,
    label: member.name,
    hint: memberRole(member.agentId) || undefined,
    avatarName: member.name,
    avatarUrl: memberAvatar(member.agentId) || undefined,
  })),
);

/** 只改默认应答者；不换当前执掌者。 */
async function setDefaultHolder(agentId: string): Promise<void> {
  if (membersLocked.value) {
    if (props.busy) showToast(t("groupMembersBusy"), "error");
    return;
  }
  if (!props.members.some((member) => member.agentId === agentId)) return;
  if (agentId === props.defaultHolderId) return;
  await commitMembers(props.members, agentId);
}

function openAdd(): void {
  if (props.busy || savingMembers.value) {
    showToast(t("groupMembersBusy"), "error");
    return;
  }
  // 满员仍保留入口，点按时说明上限，避免「添加一次就消失」的错觉
  if (atMemberCap.value) {
    showToast(tf("groupMembersFull", { max: GROUP_MEMBER_MAX }), "error");
    return;
  }
  removing.value = false;
  adding.value = true;
}

function enterRemoveMode(): void {
  if (membersLocked.value) {
    if (props.busy) showToast(t("groupMembersBusy"), "error");
    return;
  }
  if (atMemberFloor.value) {
    showToast(tf("groupNeedMembers", { min: GROUP_MEMBER_MIN, max: GROUP_MEMBER_MAX }), "error");
    return;
  }
  adding.value = false;
  removing.value = true;
}

function cancelRemove(): void {
  removing.value = false;
}

function onMemberClick(member: GroupMember): void {
  // 减员模式：勾选待删；常态：开资料
  if (removing.value) {
    if (membersLocked.value) return;
    if (removePicked.value.includes(member.agentId)) {
      removePicked.value = removePicked.value.filter((id) => id !== member.agentId);
      return;
    }
    if (remainingAfterRemove.value <= GROUP_MEMBER_MIN) {
      showToast(tf("groupNeedMembers", { min: GROUP_MEMBER_MIN, max: GROUP_MEMBER_MAX }), "error");
      return;
    }
    removePicked.value = [...removePicked.value, member.agentId];
    return;
  }
  openMemberProfile(member);
}

function openMemberProfile(member: GroupMember): void {
  if (!profileHost) return;
  const card = props.agents.find((agent) => agent.agentId === member.agentId);
  profileHost.open({
    agent: card
      ? card
      : stubAgentCard({
          agentId: member.agentId,
          name: member.name,
          role: memberRole(member.agentId),
          avatarUrl: memberAvatar(member.agentId) || undefined,
          kind: "recruited",
          recruited: true,
        }),
  });
}

async function confirmRemove(): Promise<void> {
  if (!removing.value || membersLocked.value) return;
  if (removePicked.value.length === 0) {
    removing.value = false;
    return;
  }
  const drop = new Set(removePicked.value);
  const next = props.members.filter((member) => !drop.has(member.agentId));
  await commitMembers(next);
  removing.value = false;
}

function toggleAddPick(agentId: string): void {
  if (addPicked.value.includes(agentId)) {
    addPicked.value = addPicked.value.filter((id) => id !== agentId);
    return;
  }
  const roomLeft = GROUP_MEMBER_MAX - props.members.length;
  if (addPicked.value.length >= roomLeft) {
    showToast(tf("groupNeedMembers", { min: GROUP_MEMBER_MIN, max: GROUP_MEMBER_MAX }), "error");
    return;
  }
  addPicked.value = [...addPicked.value, agentId];
}

async function confirmAdd(): Promise<void> {
  if (addPicked.value.length === 0) {
    adding.value = false;
    return;
  }
  const extras: GroupMember[] = props.agents
    .filter((agent) => addPicked.value.includes(agent.agentId))
    .map((agent) => ({
      agentId: agent.agentId,
      name: (agent.name || agent.remark || agent.agentId).trim() || agent.agentId,
    }));
  await commitMembers([...props.members, ...extras]);
  adding.value = false;
}

const confirmDelete = ref(false);
const confirmClearWorkspace = ref(false);
const includeWork = ref(false);
const deleteDisabled = computed(() => props.deleting === true);
const clearWorkspaceDisabled = computed(
  () => props.clearingWorkspace === true || props.deleting === true,
);

function askClearWorkspace(): void {
  if (clearWorkspaceDisabled.value || !props.clearWorkspace) return;
  includeWork.value = false;
  confirmClearWorkspace.value = true;
}

async function confirmClearWorkspaceAction(): Promise<void> {
  if (clearWorkspaceDisabled.value || !props.clearWorkspace) return;
  const withWork = includeWork.value;
  confirmClearWorkspace.value = false;
  await props.clearWorkspace(withWork);
}

function askDelete(): void {
  if (deleteDisabled.value || !props.deleteGroup) return;
  confirmDelete.value = true;
}

async function confirmDeleteGroup(): Promise<void> {
  if (deleteDisabled.value || !props.deleteGroup) return;
  confirmDelete.value = false;
  await props.deleteGroup();
}
</script>

<template>
  <!-- 群设置：微信式成员格 + 群名；加人面板盖住整抽屉 -->
  <div class="relative h-full min-h-0 w-full">
  <SettingsDrawerFrame :close-label="t('groupSettingsClose')" @close="emit('close')">
    <!-- 成员区 -->
    <section class="flex flex-col gap-3">
      <label class="relative block">
        <span class="sr-only">{{ t("groupMembersSearch") }}</span>
        <SearchIcon
          class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          v-model="query"
          type="search"
          :placeholder="t('groupMembersSearchPlaceholder')"
          class="min-h-8 w-full rounded-lg border border-rule bg-paper py-1.5 pr-3 pl-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/15"
        />
      </label>

      <!-- 成员网格：最多 6 人，不折叠；固定格宽避免宽抽屉拉开 -->
      <div
        class="flex flex-wrap gap-x-1 gap-y-2"
        role="list"
        :aria-label="t('groupMembersField')"
      >
        <button
          v-for="member in filteredMembers"
          :key="member.agentId"
          type="button"
          class="group relative flex w-[3.75rem] cursor-pointer flex-col items-center gap-0.5 rounded-lg border-0 bg-transparent p-0.5 outline-none transition duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/40"
          :class="removePicked.includes(member.agentId) ? 'opacity-55' : ''"
          :disabled="removing && membersLocked"
          role="listitem"
          :aria-label="
            removing
              ? member.name
              : tf('agentsViewProfile', { name: member.name })
          "
          :aria-pressed="removing ? removePicked.includes(member.agentId) : undefined"
          @click="onMemberClick(member)"
        >
          <span class="relative">
            <AgentAvatar
              :name="member.name"
              :avatar-url="memberAvatar(member.agentId)"
              size="md"
            />
            <!-- 待删勾选角标 -->
            <span
              v-if="removing && removePicked.includes(member.agentId)"
              class="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-destructive text-white"
              aria-hidden="true"
            >
              <MinusIcon class="size-2.5" />
            </span>
          </span>
          <span class="w-full truncate text-center text-[11px] leading-tight font-medium text-foreground">
            {{ member.name }}
          </span>
          <span
            v-if="memberRole(member.agentId)"
            class="w-full truncate text-center text-[10px] leading-tight text-muted-foreground"
          >
            {{ memberRole(member.agentId) }}
          </span>
        </button>

        <!-- 常态：加 / 减；减员态换成确认 / 取消 -->
        <template v-if="!removing">
          <button
            type="button"
            class="flex w-[3.75rem] flex-col items-center gap-0.5 rounded-lg border-0 bg-transparent p-0.5 outline-none transition duration-150 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-40"
            :class="atMemberCap && !membersLocked ? 'opacity-40' : ''"
            :disabled="membersLocked"
            :aria-label="t('groupMembersAdd')"
            :title="atMemberCap ? tf('groupMembersFull', { max: GROUP_MEMBER_MAX }) : t('groupMembersAdd')"
            @click="openAdd"
          >
            <span
              class="grid size-8 place-items-center rounded-lg border border-dashed border-rule text-muted-foreground transition duration-150 hover:border-accent/50 hover:text-accent"
            >
              <PlusIcon class="size-3.5" aria-hidden="true" />
            </span>
            <span class="w-full truncate text-center text-[11px] leading-tight text-muted-foreground">
              {{ t("groupMembersAdd") }}
            </span>
          </button>

          <button
            v-if="!atMemberFloor"
            type="button"
            class="flex w-[3.75rem] flex-col items-center gap-0.5 rounded-lg border-0 bg-transparent p-0.5 outline-none transition duration-150 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="membersLocked"
            :aria-label="t('groupMembersRemove')"
            @click="enterRemoveMode"
          >
            <span
              class="grid size-8 place-items-center rounded-lg border border-dashed border-rule text-muted-foreground transition duration-150 hover:border-accent/50 hover:text-accent"
            >
              <MinusIcon class="size-3.5" aria-hidden="true" />
            </span>
            <span class="w-full truncate text-center text-[11px] leading-tight text-muted-foreground">
              {{ t("groupMembersRemove") }}
            </span>
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            class="flex w-[3.75rem] flex-col items-center gap-0.5 rounded-lg border-0 bg-transparent p-0.5 outline-none transition duration-150 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="membersLocked"
            :aria-label="t('groupMembersRemoveConfirm')"
            @click="confirmRemove"
          >
            <span
              class="grid size-8 place-items-center rounded-lg border border-dashed border-accent/50 text-accent transition duration-150 hover:border-accent hover:bg-accent/10"
            >
              <CheckIcon class="size-3.5" aria-hidden="true" />
            </span>
            <span class="w-full truncate text-center text-[11px] leading-tight text-muted-foreground">
              {{ t("groupMembersRemoveConfirm") }}
            </span>
          </button>
          <button
            type="button"
            class="flex w-[3.75rem] flex-col items-center gap-0.5 rounded-lg border-0 bg-transparent p-0.5 outline-none transition duration-150 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="membersLocked"
            :aria-label="t('cancel')"
            @click="cancelRemove"
          >
            <span
              class="grid size-8 place-items-center rounded-lg border border-dashed border-rule text-muted-foreground transition duration-150 hover:border-accent/50 hover:text-accent"
            >
              <XIcon class="size-3.5" aria-hidden="true" />
            </span>
            <span class="w-full truncate text-center text-[11px] leading-tight text-muted-foreground">
              {{ t("cancel") }}
            </span>
          </button>
        </template>
      </div>
    </section>

    <div class="my-4 border-t border-rule" aria-hidden="true" />

    <!-- 默认应答者：下拉选择，改字段不切换当前执掌者 -->
    <section class="flex flex-col gap-2">
      <h3 class="m-0 text-sm font-semibold tracking-tight text-foreground">
        {{ t("groupDefaultHolderField") }}
      </h3>
      <p class="m-0 text-xs leading-snug text-muted-foreground">
        {{ t("groupDefaultHolderHint") }}
      </p>
      <AppDropdownMenu
        :items="defaultHolderItems"
        align="start"
        @select="setDefaultHolder"
      >
        <template #trigger>
          <button
            type="button"
            class="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg border border-rule bg-paper px-2.5 py-1.5 text-left text-sm text-foreground outline-none transition duration-150 hover:border-accent/40 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="membersLocked || !defaultHolderMember"
            :aria-label="t('groupDefaultHolderField')"
          >
            <template v-if="defaultHolderMember">
              <AgentAvatar
                :name="defaultHolderMember.name"
                :avatar-url="memberAvatar(defaultHolderMember.agentId)"
                size="sm"
                round
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ defaultHolderMember.name }}</span>
                <span
                  v-if="memberRole(defaultHolderMember.agentId)"
                  class="mt-0.5 block truncate text-xs text-muted-foreground"
                >
                  {{ memberRole(defaultHolderMember.agentId) }}
                </span>
              </span>
            </template>
            <span v-else class="min-w-0 flex-1 truncate text-muted-foreground">
              {{ t("groupDefaultHolderField") }}
            </span>
            <ChevronDownIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </template>
      </AppDropdownMenu>
    </section>

    <div class="my-4 border-t border-rule" aria-hidden="true" />

    <!-- 群名称 -->
    <section class="flex flex-col gap-2">
      <h3 class="m-0 text-sm font-semibold tracking-tight text-foreground">
        {{ t("groupTitleField") }}
      </h3>
      <label class="grid gap-2" for="group-settings-title">
        <span class="sr-only">{{ t("groupTitleField") }}</span>
        <input
          id="group-settings-title"
          v-model="draft"
          type="text"
          maxlength="40"
          class="min-h-8 w-full rounded-lg border border-rule bg-paper px-3 text-sm outline-none transition duration-200 placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/15"
          :placeholder="t('groupTitlePlaceholder')"
          :disabled="savingTitle"
          @change="saveTitle"
          @keydown.enter.prevent="saveTitle"
        />
      </label>
      <p class="m-0 text-xs leading-snug text-muted-foreground">
        {{ t("groupTitleBody") }}
      </p>
    </section>

    <!-- 危险操作：清空工作区 / 删除群 -->
    <section class="mt-6 flex flex-col gap-2 border-t border-rule pt-4">
      <button
        type="button"
        class="flex min-h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-destructive transition duration-150 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="clearWorkspaceDisabled"
        @click="askClearWorkspace"
      >
        <FolderXIcon class="size-3.5" aria-hidden="true" />
        {{ t("groupClearWorkspace") }}
      </button>
      <button
        type="button"
        class="flex min-h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-destructive transition duration-150 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="deleteDisabled"
        @click="askDelete"
      >
        <Trash2Icon class="size-3.5" aria-hidden="true" />
        {{ t("groupDelete") }}
      </button>
    </section>

  </SettingsDrawerFrame>

  <!-- 清空工作区确认 -->
  <AppDialog
    :open="confirmClearWorkspace"
    :title="t('groupClearWorkspaceTitle')"
    :description="t('groupClearWorkspaceBody')"
    @update:open="confirmClearWorkspace = $event"
  >
    <label class="flex cursor-pointer items-center gap-2 text-sm text-foreground">
      <input
        v-model="includeWork"
        type="checkbox"
        class="size-4 rounded border-rule text-accent accent-accent"
      />
      <span>{{ t("groupClearWorkspaceAlso") }}</span>
    </label>
    <template #footer>
      <button
        type="button"
        class="min-h-8 cursor-pointer rounded-lg border border-rule px-3 text-sm font-medium transition duration-200 hover:bg-paper-deep"
        @click="confirmClearWorkspace = false"
      >
        {{ t("cancel") }}
      </button>
      <button
        type="button"
        class="min-h-8 cursor-pointer rounded-lg bg-destructive px-3 text-sm font-semibold text-white transition duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="clearWorkspaceDisabled"
        @click="confirmClearWorkspaceAction"
      >
        {{ t("groupClearWorkspaceConfirm") }}
      </button>
    </template>
  </AppDialog>
  <!-- 删除群确认 -->
  <AppDialog
    :open="confirmDelete"
    :title="t('groupDeleteTitle')"
    :description="t('groupDeleteBody')"
    @update:open="confirmDelete = $event"
  >
    <template #footer>
      <button
        type="button"
        class="min-h-8 cursor-pointer rounded-lg border border-rule px-3 text-sm font-medium transition duration-200 hover:bg-paper-deep"
        @click="confirmDelete = false"
      >
        {{ t("cancel") }}
      </button>
      <button
        type="button"
        class="min-h-8 cursor-pointer rounded-lg bg-destructive px-3 text-sm font-semibold text-white transition duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="deleteDisabled"
        @click="confirmDeleteGroup"
      >
        {{ t("groupDelete") }}
      </button>
    </template>
  </AppDialog>

    <!-- 加人面板：盖住整抽屉 -->
    <div
      v-if="adding"
      class="absolute inset-0 z-20 flex flex-col bg-background"
      role="dialog"
      :aria-label="t('groupMembersAddTitle')"
    >
      <header class="flex shrink-0 items-center gap-2 border-b border-rule px-3 py-2.5">
        <button
          type="button"
          class="grid size-8 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground outline-none transition duration-150 hover:bg-paper hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
          :aria-label="t('cancel')"
          @click="adding = false"
        >
          <XIcon class="size-4" aria-hidden="true" />
        </button>
        <h3 class="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {{ t("groupMembersAddTitle") }}
        </h3>
        <button
          type="button"
          class="min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-150 hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="savingMembers || addPicked.length === 0"
          @click="confirmAdd"
        >
          {{ t("groupMembersAddConfirm") }}
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <label class="relative mb-3 block">
          <span class="sr-only">{{ t("groupMembersSearch") }}</span>
          <SearchIcon
            class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            v-model="addQuery"
            type="search"
            :placeholder="t('groupMembersSearchPlaceholder')"
            class="min-h-8 w-full rounded-lg border border-rule bg-paper py-1.5 pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/15"
          />
        </label>
        <p
          v-if="candidates.length === 0"
          class="m-0 rounded-xl border border-dashed border-rule bg-paper px-4 py-8 text-center text-sm text-muted-foreground"
        >
          {{
            props.agents.length === 0
              ? t("groupNoAgents")
              : addQuery.trim()
                ? t("groupMembersNoMatch")
                : t("groupMembersAddEmpty")
          }}
        </p>
        <div v-else class="flex flex-col gap-1.5">
          <button
            v-for="agent in candidates"
            :key="agent.agentId"
            type="button"
            class="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-left transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            :class="
              addPicked.includes(agent.agentId)
                ? 'border-accent bg-accent/10'
                : 'border-rule bg-paper hover:border-accent/40'
            "
            :aria-pressed="addPicked.includes(agent.agentId)"
            @click="toggleAddPick(agent.agentId)"
          >
            <AgentAvatar
              :name="agentLabel(agent)"
              :avatar-url="agent.avatarUrl"
              size="sm"
              round
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-foreground">
                {{ agentLabel(agent) }}
              </span>
              <span
                v-if="agent.role.trim()"
                class="mt-0.5 block truncate text-xs text-muted-foreground"
              >
                {{ agent.role }}
              </span>
            </span>
            <span
              class="grid size-5 shrink-0 place-items-center rounded-md border transition duration-150"
              :class="
                addPicked.includes(agent.agentId)
                  ? 'border-accent bg-accent text-white'
                  : 'border-rule bg-background text-transparent'
              "
              aria-hidden="true"
            >
              <CheckIcon class="size-3" />
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
