<script setup lang="ts">
import { computed, ref, watch } from "vue";

import AppDialog from "../../../shared/components/AppDialog.vue";
import GroupAvatar from "../../../shared/components/avatar/GroupAvatar.vue";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { AgentCard, TeamCard, TeamMemberCard } from "../../../shared/model/runtime/runtime";
import { showToast } from "../../../shared/model/ui/toast";
import { t, tf } from "../../../shared/model/ui/ui-locale";
import AgentMarketCard from "./market/AgentMarketCard.vue";

const props = defineProps<{
  open: boolean;
  team: TeamCard;
  busy?: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  recruit: [teamId: string];
  chat: [agent: AgentCard];
}>();

const api = new DesktopApi();
const memberAgents = ref<AgentCard[]>([]);
const loadingMembers = ref(false);

const faces = computed(() =>
  props.team.members.map((member) => ({
    agentId: member.agentId,
    avatarUrl: member.avatarUrl,
  })),
);

function stubFromMember(member: TeamMemberCard): AgentCard {
  return {
    agentId: member.agentId,
    name: member.name,
    role: member.role,
    background: "",
    latestVersion: 0,
    latestDigest: "",
    localVersion: 0,
    recruited: false,
    hasAvatar: member.hasAvatar,
    avatarUrl: member.avatarUrl,
    remark: "",
    recruitCount: 0,
    createdAt: "",
    updatedAt: "",
  };
}

async function loadMemberAgents(): Promise<void> {
  const members = props.team.members;
  if (!members.length) {
    memberAgents.value = [];
    return;
  }
  loadingMembers.value = true;
  try {
    // 按 Agent ID 拉取公开名片补全简介；失败则用花名册摘要
    const cards = await Promise.all(
      members.map(async (member) => {
        try {
          const hits = await api.publicAgents({ q: member.agentId });
          const exact = hits.find((item) => item.agentId === member.agentId);
          return exact ?? stubFromMember(member);
        } catch {
          return stubFromMember(member);
        }
      }),
    );
    memberAgents.value = cards;
  } catch (caught) {
    showToast(caught instanceof DesktopApiError ? caught.message : t("agentsLoadFailed"), "error");
    memberAgents.value = members.map(stubFromMember);
  } finally {
    loadingMembers.value = false;
  }
}

watch(
  () => [props.open, props.team.teamId] as const,
  ([open]) => {
    if (open) void loadMemberAgents();
    else memberAgents.value = [];
  },
);

function runRecruit(): void {
  if (props.busy) return;
  emit("update:open", false);
  emit("recruit", props.team.teamId);
}
</script>

<template>
  <!-- 团队资料：简介 + 成员花名册（只读卡，无单招） -->
  <AppDialog
    :open="open"
    :title="team.name"
    :description="tf('teamsMemberCount', { n: team.members.length })"
    size="xl"
    align="center"
    title-class="m-0 text-lg font-semibold leading-snug tracking-tight"
    description-class="m-0 mt-1 break-words text-sm font-semibold leading-snug text-accent"
    @update:open="emit('update:open', $event)"
  >
    <template #leading>
      <GroupAvatar
        class="ring-1 ring-rule ring-offset-2 ring-offset-paper"
        :faces="faces"
        :show-user="false"
        size="sidebar"
      />
    </template>
    <template v-if="team.recruited" #title-trailing>
      <span
        class="inline-flex items-center rounded-md bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold leading-none text-success-foreground"
      >
        {{ t("teamsRecruited") }}
      </span>
    </template>

    <div class="flex flex-col gap-4 pb-1">
      <div class="min-w-0">
        <p class="m-0 text-xs font-medium text-muted-foreground">{{ t("teamsFieldBackground") }}</p>
        <p class="m-0 mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {{ team.background || t("teamsProfileNoBackground") }}
        </p>
      </div>

      <section class="min-w-0" :aria-label="t('teamsProfileMembers')">
        <h3 class="m-0 mb-2 text-sm font-semibold text-foreground">{{ t("teamsProfileMembers") }}</h3>
        <p v-if="loadingMembers" class="m-0 text-xs text-muted-foreground">{{ t("agentsLocalLoading") }}</p>
        <div v-else class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <AgentMarketCard
            v-for="agent in memberAgents"
            :key="agent.agentId"
            surface="roster"
            :agent="agent"
            :busy="false"
            @chat="emit('chat', $event)"
          />
        </div>
      </section>
    </div>

    <template v-if="!team.recruited" #footer>
      <button
        type="button"
        class="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-white transition duration-150 hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="busy"
        @click="runRecruit"
      >
        {{ busy ? t("teamsRecruiting") : t("teamsRecruitOpen") }}
      </button>
    </template>
  </AppDialog>
</template>
