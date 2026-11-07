<script setup lang="ts">
import { UsersIcon } from "@lucide/vue";
import { ref } from "vue";

import TeamCatalogCard from "../../../../shared/components/team/TeamCatalogCard.vue";
import type { AgentCard, TeamCard } from "../../../../shared/model/runtime/runtime";
import { t, tf } from "../../../../shared/model/ui/ui-locale";
import TeamProfileDialog from "../TeamProfileDialog.vue";

defineProps<{
  team: TeamCard;
  busy: boolean;
}>();

const emit = defineEmits<{
  recruit: [teamId: string];
  chat: [agent: AgentCard];
}>();

const profileOpen = ref(false);
</script>

<template>
  <!-- 市场团队卡：点卡开资料；页脚显示加群次数，未加群时再出加群钮 -->
  <TeamCatalogCard
    :team="team"
    :title-id="`team-card-${team.teamId}`"
    @view-profile="profileOpen = true"
  >
    <template v-if="team.recruited" #badge>
      <span
        class="inline-flex shrink-0 items-center rounded-md bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold leading-none text-success-foreground"
      >
        {{ t("teamsRecruited") }}
      </span>
    </template>
    <template #footer>
      <span
        class="inline-flex min-w-0 flex-1 items-center gap-1 truncate text-[11px] tabular-nums text-muted-foreground"
        :aria-label="tf('teamsJoinCount', { n: team.recruitCount })"
      >
        <UsersIcon class="size-3 shrink-0 opacity-70" aria-hidden="true" />
        {{ tf("teamsJoinCount", { n: team.recruitCount }) }}
      </span>
      <button
        v-if="!team.recruited"
        type="button"
        class="inline-flex min-h-7 shrink-0 cursor-pointer items-center rounded-lg bg-accent px-2.5 text-xs font-semibold text-white outline-none transition duration-200 hover:bg-accent-deep focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
        :disabled="busy"
        @click="emit('recruit', team.teamId)"
      >
        {{ busy ? t("teamsRecruiting") : t("teamsRecruitOpen") }}
      </button>
    </template>
  </TeamCatalogCard>

  <TeamProfileDialog
    :open="profileOpen"
    :team="team"
    :busy="busy"
    @update:open="profileOpen = $event"
    @recruit="emit('recruit', $event)"
    @chat="emit('chat', $event)"
  />
</template>
