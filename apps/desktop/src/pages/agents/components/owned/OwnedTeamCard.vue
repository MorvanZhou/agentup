<script setup lang="ts">
import { Trash2Icon, UsersIcon } from "@lucide/vue";
import { RouterLink } from "vue-router";

import TeamCatalogCard from "../../../../shared/components/team/TeamCatalogCard.vue";
import type { TeamCard } from "../../../../shared/model/runtime/runtime";
import { t, tf } from "../../../../shared/model/ui/ui-locale";

defineProps<{
  team: TeamCard;
  busy: boolean;
}>();

const emit = defineEmits<{
  remove: [teamId: string];
}>();
</script>

<template>
  <!-- 我的团队卡：与 Agent / 市场团队卡同构 -->
  <TeamCatalogCard :team="team" :title-id="`owned-team-${team.teamId}`">
    <template #trailing>
      <button
        type="button"
        class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition hover:bg-muted hover:text-destructive focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-45"
        :disabled="busy"
        :aria-label="tf('teamsDeleteAria', { name: team.name })"
        @click="emit('remove', team.teamId)"
      >
        <Trash2Icon class="size-3.5" aria-hidden="true" />
      </button>
    </template>
    <template #footer>
      <span
        class="inline-flex min-w-0 flex-1 items-center gap-1 truncate text-[11px] tabular-nums text-muted-foreground"
      >
        <UsersIcon class="size-3 shrink-0 opacity-70" aria-hidden="true" />
        {{ tf("teamsJoinCount", { n: team.recruitCount }) }}
      </span>
      <RouterLink
        class="inline-flex min-h-7 shrink-0 items-center rounded-lg border border-rule bg-paper px-2.5 text-xs font-semibold text-foreground no-underline transition hover:bg-muted"
        :to="{ name: 'teams-owned-edit', params: { teamId: team.teamId } }"
      >
        {{ t("teamsEdit") }}
      </RouterLink>
    </template>
  </TeamCatalogCard>
</template>
