<script setup lang="ts">
import { SearchIcon, XIcon } from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useDesktop } from "../../app/desktop";
import AgentAvatar from "../../shared/components/avatar/AgentAvatar.vue";
import PageEditorHeader from "../../shared/components/PageEditorHeader.vue";
import UiFormSkeleton from "../../shared/components/UiFormSkeleton.vue";
import { DesktopApi, DesktopApiError } from "../../shared/api/runtime";
import type { AgentCard, TeamCard } from "../../shared/model/runtime/runtime";
import {
  BACKGROUND_MAX,
  NAME_MAX,
  SEARCH_QUERY_MAX,
  TEAM_MEMBER_MAX,
  TEAM_MEMBER_MIN,
} from "../../shared/model/input-limits";
import { showToast } from "../../shared/model/ui/toast";
import { t, tf } from "../../shared/model/ui/ui-locale";

type PickedMember = { agentId: string; name: string; role: string; avatarUrl?: string };

/** 聚焦空搜时：按招募量取一批高频候选 */
const POPULAR_CANDIDATE_MAX = 12;

const route = useRoute();
const router = useRouter();
const { session, refresh } = useDesktop();
const api = new DesktopApi();

const editingId = computed(() => {
  const raw = route.params.teamId;
  return typeof raw === "string" && raw !== "new" ? raw : "";
});

const loading = ref(true);
const saving = ref(false);
const name = ref("");
const background = ref("");
const picked = ref<PickedMember[]>([]);
const defaultHolderId = ref<string | null>(null);
const agentQuery = ref("");
const candidates = ref<AgentCard[]>([]);
const candidateLoading = ref(false);
const searchOpen = ref(false);
const searchRoot = ref<HTMLElement | null>(null);

const pickedIds = computed(() => new Set(picked.value.map((m) => m.agentId)));

const canSave = computed(() => {
  return (
    name.value.trim() &&
    background.value.trim() &&
    picked.value.length >= TEAM_MEMBER_MIN &&
    picked.value.length <= TEAM_MEMBER_MAX &&
    defaultHolderId.value &&
    pickedIds.value.has(defaultHolderId.value)
  );
});

function byRecruitCount(a: AgentCard, b: AgentCard): number {
  const diff = (b.recruitCount ?? 0) - (a.recruitCount ?? 0);
  if (diff !== 0) return diff;
  return a.name.localeCompare(b.name, "zh");
}

async function loadCandidates(): Promise<void> {
  const current = session.value;
  if (!current) {
    candidates.value = [];
    return;
  }
  const q = agentQuery.value.trim();
  candidateLoading.value = true;
  try {
    const list = await api.publicAgents(q ? { q } : undefined);
    // 空搜：高频优先截一批；有关键词：仍按招募量排，方便同名里挑常用
    const sorted = [...list].sort(byRecruitCount);
    candidates.value = q ? sorted : sorted.slice(0, POPULAR_CANDIDATE_MAX);
  } catch (caught) {
    showToast(caught instanceof DesktopApiError ? caught.message : t("agentsLoadFailed"), "error");
    candidates.value = [];
  } finally {
    candidateLoading.value = false;
  }
}

async function loadExisting(): Promise<void> {
  const current = session.value;
  if (!current || !editingId.value) {
    loading.value = false;
    return;
  }
  try {
    const team: TeamCard = await api.getTeam(current.token, editingId.value);
    name.value = team.name;
    background.value = team.background;
    picked.value = team.members.map((m) => ({
      agentId: m.agentId,
      name: m.name,
      role: m.role,
      avatarUrl: m.avatarUrl,
    }));
    defaultHolderId.value = team.defaultHolderAgentId;
  } catch (caught) {
    showToast(caught instanceof DesktopApiError ? caught.message : t("teamsLoadFailed"), "error");
    void router.replace({ name: "teams-owned" });
  } finally {
    loading.value = false;
  }
}

function addMember(agent: AgentCard): void {
  if (pickedIds.value.has(agent.agentId)) return;
  if (picked.value.length >= TEAM_MEMBER_MAX) {
    showToast(tf("teamsNeedMembers", { min: TEAM_MEMBER_MIN, max: TEAM_MEMBER_MAX }), "error");
    return;
  }
  picked.value = [
    ...picked.value,
    {
      agentId: agent.agentId,
      name: agent.name,
      role: agent.role,
      avatarUrl: agent.avatarUrl,
    },
  ];
  if (!defaultHolderId.value) defaultHolderId.value = agent.agentId;
}

function removeMember(agentId: string): void {
  picked.value = picked.value.filter((m) => m.agentId !== agentId);
  if (defaultHolderId.value === agentId) {
    defaultHolderId.value = picked.value[0]?.agentId ?? null;
  }
}

function setDefault(agentId: string): void {
  if (!pickedIds.value.has(agentId)) return;
  defaultHolderId.value = agentId;
}

function openSearch(): void {
  searchOpen.value = true;
  void loadCandidates();
}

function onDocumentPointerDown(event: PointerEvent): void {
  const root = searchRoot.value;
  if (!root || !searchOpen.value) return;
  if (event.target instanceof Node && !root.contains(event.target)) {
    searchOpen.value = false;
  }
}

function goBack(): void {
  // 优先回到上一页（市场 / 我的团队等）；无历史时落到我的团队
  if (window.history.length > 1) {
    router.back();
    return;
  }
  void router.replace({ name: "teams-owned" });
}

async function save(): Promise<void> {
  const current = session.value;
  if (!current || !canSave.value || saving.value) return;
  saving.value = true;
  try {
    const input = {
      name: name.value.trim(),
      background: background.value.trim(),
      memberIds: picked.value.map((m) => m.agentId),
      defaultHolderAgentId: defaultHolderId.value!,
    };
    if (editingId.value) {
      await api.updateTeam(current.token, editingId.value, input);
    } else {
      await api.createTeam(current.token, input);
    }
    await refresh();
    showToast(t("teamsSaved"), "success");
    void router.push({ name: "teams-owned" });
  } catch (caught) {
    showToast(caught instanceof DesktopApiError ? caught.message : t("teamsSaveFailed"), "error");
  } finally {
    saving.value = false;
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(agentQuery, () => {
  if (!searchOpen.value) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void loadCandidates();
  }, 250);
});

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown);
  void loadExisting();
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  clearTimeout(searchTimer);
});
</script>

<template>
  <main class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <!-- 发布 / 编辑团队：名称、简介、搜索加人 -->
    <PageEditorHeader
      :title="editingId ? t('teamsEditTitle') : t('teamsCreateTitle')"
      @back="goBack"
    >
      <template #actions>
        <button
          type="button"
          class="inline-flex min-h-8 items-center rounded-lg border border-rule bg-paper px-3 text-sm font-semibold text-foreground outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent/40"
          @click="goBack"
        >
          {{ t("agentsLocalCancel") }}
        </button>
        <button
          type="button"
          class="inline-flex min-h-8 items-center rounded-lg bg-accent px-3 text-sm font-semibold text-white outline-none transition hover:bg-accent-deep focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-45"
          :disabled="!canSave || saving"
          @click="save"
        >
          {{ saving ? t("teamsSaving") : t("teamsSave") }}
        </button>
      </template>
    </PageEditorHeader>

    <div class="min-h-0 flex-1 overflow-auto">
      <div class="mx-auto w-full max-w-3xl px-4 py-5">
        <UiFormSkeleton v-if="loading" />
        <form v-else class="flex flex-col gap-4" @submit.prevent="save">
          <p class="m-0 text-sm text-muted-foreground">{{ t("teamsCreateDesc") }}</p>
          <!-- 名片：名称 + 简介 -->
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-semibold text-muted-foreground">{{ t("teamsFieldName") }}</span>
            <input
              v-model="name"
              type="text"
              :maxlength="NAME_MAX"
              class="min-h-8 rounded-lg border border-rule bg-paper px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-semibold text-muted-foreground">{{ t("teamsFieldBackground") }}</span>
            <textarea
              v-model="background"
              rows="3"
              :maxlength="BACKGROUND_MAX"
              class="rounded-lg border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </label>

          <!-- 成员：搜索在上（悬浮结果），已选列表在下 -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <h2 class="m-0 text-sm font-semibold text-foreground">
                {{ tf("teamsPickMembers", { min: TEAM_MEMBER_MIN, max: TEAM_MEMBER_MAX }) }}
              </h2>
              <span class="text-xs text-muted-foreground">{{ picked.length }} / {{ TEAM_MEMBER_MAX }}</span>
            </div>

            <!-- 搜索框 + 悬浮候选 -->
            <div ref="searchRoot" class="relative z-20">
              <label class="relative block">
                <span class="sr-only">{{ t("teamsSearchAdd") }}</span>
                <SearchIcon
                  class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  v-model="agentQuery"
                  type="search"
                  :maxlength="SEARCH_QUERY_MAX"
                  :placeholder="t('teamsSearchAddPlaceholder')"
                  class="min-h-8 w-full rounded-lg border border-rule bg-paper py-1.5 pr-2.5 pl-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/15"
                  autocomplete="off"
                  @focus="openSearch"
                />
              </label>
              <div
                v-if="searchOpen"
                class="absolute top-full right-0 left-0 mt-1 overflow-hidden rounded-lg border border-rule bg-paper shadow-md"
                role="listbox"
                :aria-label="t('teamsSearchAdd')"
              >
                <p
                  v-if="candidateLoading"
                  class="m-0 px-3 py-2.5 text-xs text-muted-foreground"
                >
                  {{ t("agentsLocalLoading") }}
                </p>
                <ul
                  v-else-if="candidates.length"
                  class="m-0 max-h-56 list-none overflow-auto p-1"
                >
                  <li v-for="agent in candidates" :key="agent.agentId">
                    <button
                      type="button"
                      role="option"
                      class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left outline-none transition"
                      :class="
                        pickedIds.has(agent.agentId)
                          ? 'cursor-default opacity-55'
                          : 'cursor-pointer hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-accent/40'
                      "
                      :aria-selected="pickedIds.has(agent.agentId)"
                      :disabled="pickedIds.has(agent.agentId)"
                      @mousedown.prevent
                      @click="addMember(agent)"
                    >
                      <AgentAvatar
                        class="ring-1 ring-rule ring-offset-1 ring-offset-paper"
                        :name="agent.name"
                        :avatar-url="agent.avatarUrl"
                        size="sm"
                      />
                      <div class="min-w-0 flex-1">
                        <p class="m-0 truncate text-sm font-medium text-foreground">{{ agent.name }}</p>
                        <p class="m-0 truncate text-xs text-muted-foreground">
                          <span v-if="agent.role" class="font-semibold text-muted-foreground">{{ agent.role }}</span>
                          <span v-if="agent.role" class="text-muted-foreground"> · </span>
                          <span class="font-mono">{{ agent.agentId }}</span>
                          <span v-if="!agentQuery.trim()">
                            · {{ tf("agentsRecruitCount", { n: agent.recruitCount }) }}
                          </span>
                        </p>
                      </div>
                      <span
                        v-if="pickedIds.has(agent.agentId)"
                        class="shrink-0 text-[11px] font-semibold text-muted-foreground"
                      >
                        {{ t("teamsMemberAdded") }}
                      </span>
                    </button>
                  </li>
                </ul>
                <p v-else class="m-0 px-3 py-2.5 text-xs text-muted-foreground">
                  {{
                    agentQuery.trim() ? t("teamsSearchNoMatch") : t("teamsSearchPopularEmpty")
                  }}
                </p>
              </div>
            </div>

            <!-- 已选成员列表 -->
            <ul
              v-if="picked.length"
              class="m-0 flex list-none flex-col gap-1 p-0"
            >
              <li
                v-for="member in picked"
                :key="member.agentId"
                class="flex items-center gap-2.5 rounded-lg border border-rule bg-paper px-2.5 py-2"
              >
                <AgentAvatar
                  class="ring-1 ring-rule ring-offset-1 ring-offset-paper"
                  :name="member.name"
                  :avatar-url="member.avatarUrl"
                  size="sm"
                />
                <div class="min-w-0 flex-1">
                  <p class="m-0 truncate text-sm font-medium text-foreground">{{ member.name }}</p>
                  <p class="m-0 truncate text-xs text-muted-foreground">
                    <span v-if="member.role" class="font-semibold text-muted-foreground">{{ member.role }}</span>
                    <span v-if="member.role" class="text-muted-foreground"> · </span>
                    <span class="font-mono text-[11px]">{{ member.agentId }}</span>
                  </p>
                </div>
                <button
                  type="button"
                  class="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold outline-none transition"
                  :class="
                    defaultHolderId === member.agentId
                      ? 'bg-muted text-foreground ring-1 ring-foreground/15'
                      : 'text-muted-foreground hover:bg-muted'
                  "
                  @click="setDefault(member.agentId)"
                >
                  {{
                    defaultHolderId === member.agentId
                      ? t("teamsDefaultHolder")
                      : t("teamsSetDefaultHolder")
                  }}
                </button>
                <button
                  type="button"
                  class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition hover:bg-muted hover:text-destructive focus-visible:ring-2 focus-visible:ring-accent/40"
                  :aria-label="tf('teamsRemoveMemberAria', { name: member.name })"
                  @click="removeMember(member.agentId)"
                >
                  <XIcon class="size-3.5" aria-hidden="true" />
                </button>
              </li>
            </ul>
            <p v-else class="m-0 text-xs text-muted-foreground">{{ t("teamsPickEmpty") }}</p>
          </div>
        </form>
      </div>
    </div>
  </main>
</template>
