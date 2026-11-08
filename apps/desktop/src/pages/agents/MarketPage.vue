<script setup lang="ts">
import { ChevronRightIcon, PlusIcon, SearchIcon } from "@lucide/vue";
import { computed, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";

import { useDesktop } from "../../app/desktop";
import type { AgentCard } from "../../shared/model/runtime/runtime";
import PageChromeHeader from "../../shared/components/PageChromeHeader.vue";
import { SEARCH_QUERY_MAX } from "../../shared/model/input-limits";
import { t } from "../../shared/model/ui/ui-locale";
import AgentCatalogSkeleton from "./components/AgentCatalogSkeleton.vue";
import AgentMarketCard from "./components/market/AgentMarketCard.vue";
import TeamMarketCard from "./components/market/TeamMarketCard.vue";
import { useAgentCatalog } from "./composables/useAgentCatalog";
import { useAgentMarket } from "./composables/useAgentMarket";
import { useTeamCatalog } from "./composables/useTeamCatalog";
import { useTeamMarket } from "./composables/useTeamMarket";

/** 宽屏约 5 列 × 3 行；窄屏自然更少列、仍截到同数。 */
const TEAM_PREVIEW_MAX = 15;
const AGENT_PREVIEW_MAX = 15;

const router = useRouter();
const { session, refresh, select } = useDesktop();
const query = ref("");
const section = computed(() => "market" as const);
const teamScope = computed(() => "market" as const);
const catalog = useAgentCatalog(session, section, query);
const teamCatalog = useTeamCatalog(session, teamScope, query);
const market = useAgentMarket(session, async () => {
  await refresh();
  await catalog.reload();
});
const teamMarket = useTeamMarket(session, async () => {
  await refresh();
  await teamCatalog.reload();
});
const searching = computed(() => Boolean(query.value.trim()));
const teamPreview = computed(() => teamCatalog.teams.value.slice(0, TEAM_PREVIEW_MAX));
const agentPreview = computed(() => catalog.agents.value.slice(0, AGENT_PREVIEW_MAX));
const teamsHasMore = computed(() => teamCatalog.teams.value.length > TEAM_PREVIEW_MAX);
const agentsHasMore = computed(() => catalog.agents.value.length > AGENT_PREVIEW_MAX);

function openChat(agent: AgentCard): void {
  select(agent);
  void router.push({ name: "conversation" });
}
</script>

<template>
  <main class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <!-- 市场总览：团队预览（约 3 行）→ Agent 预览（约 3 行） -->
    <PageChromeHeader :title="t('marketTitle')">
      <template #actions>
        <label class="relative min-w-0 max-w-56 flex-1">
          <span class="sr-only">{{ t("agentsSearch") }}</span>
          <SearchIcon
            class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            v-model="query"
            type="search"
            :maxlength="SEARCH_QUERY_MAX"
            :placeholder="t('agentsSearchPlaceholder')"
            class="min-h-8 w-full rounded-lg border border-rule bg-paper py-1.5 pr-2.5 pl-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/15"
          />
        </label>
      </template>
    </PageChromeHeader>

    <div class="min-h-0 flex-1 overflow-auto">
      <div class="mx-auto flex w-full max-w-7xl flex-col gap-20 px-4 py-4 sm:px-5 sm:py-5">
        <!-- 团队 section -->
        <section class="min-w-0" :aria-label="t('marketKindTeams')">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 class="mb-3 text-xl font-semibold tracking-tight text-foreground">
              {{ t("marketKindTeams") }}
            </h2>
            <RouterLink
              class="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-accent no-underline transition duration-200 hover:text-accent-deep"
              :to="{ name: 'market-teams', query: query.trim() ? { q: query.trim() } : undefined }"
            >
              {{ t("marketViewMore") }}
              <ChevronRightIcon class="size-3.5" aria-hidden="true" />
            </RouterLink>
          </div>
          <!-- 发布钮在卡片网格左上（与「我的团队 / 我发布的」一致） -->
          <div class="mb-3 flex items-center justify-start">
            <RouterLink
              class="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-white no-underline transition duration-200 hover:bg-accent-deep"
              :to="{ name: 'teams-owned-new' }"
            >
              <PlusIcon class="size-3.5" aria-hidden="true" />
              {{ t("teamsPublish") }}
            </RouterLink>
          </div>
          <div
            v-if="teamPreview.length"
            class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          >
            <TeamMarketCard
              v-for="team in teamPreview"
              :key="team.teamId"
              :team="team"
              :busy="teamMarket.busyTeamId.value === team.teamId"
              @recruit="teamMarket.recruit"
              @chat="openChat"
            />
          </div>
          <AgentCatalogSkeleton v-else-if="teamCatalog.loading.value" dense />
          <div
            v-else-if="searching"
            class="rounded-xl border border-dashed border-rule bg-background px-4 py-8 text-center"
          >
            <p class="m-0 text-sm text-muted-foreground">{{ t("teamsNoMatch") }}</p>
          </div>
          <div
            v-else
            class="rounded-xl border border-dashed border-rule bg-background px-4 py-8 text-center"
          >
            <p class="m-0 text-sm text-muted-foreground">{{ t("teamsEmptyMarket") }}</p>
          </div>
          <div v-if="teamsHasMore" class="mt-2 flex justify-end">
            <RouterLink
              class="inline-flex min-h-8 items-center gap-1 text-sm font-semibold text-accent no-underline hover:text-accent-deep"
              :to="{ name: 'market-teams', query: query.trim() ? { q: query.trim() } : undefined }"
            >
              {{ t("marketViewMore") }}
              <ChevronRightIcon class="size-3.5" aria-hidden="true" />
            </RouterLink>
          </div>
        </section>

        <!-- Agent section -->
        <section class="min-w-0" :aria-label="t('marketKindAgents')">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 class="mb-3 text-xl font-semibold tracking-tight text-foreground">
              {{ t("marketKindAgents") }}
            </h2>
            <RouterLink
              class="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-accent no-underline transition duration-200 hover:text-accent-deep"
              :to="{ name: 'market-agents', query: query.trim() ? { q: query.trim() } : undefined }"
            >
              {{ t("marketViewMore") }}
              <ChevronRightIcon class="size-3.5" aria-hidden="true" />
            </RouterLink>
          </div>
          <div class="mb-3 flex items-center justify-start">
            <RouterLink
              class="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-white no-underline transition duration-200 hover:bg-accent-deep"
              :to="{ name: 'agents-owned-new' }"
            >
              <PlusIcon class="size-3.5" aria-hidden="true" />
              {{ t("agentsPublish") }}
            </RouterLink>
          </div>
          <div
            v-if="agentPreview.length"
            class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          >
            <AgentMarketCard
              v-for="agent in agentPreview"
              :key="agent.agentId"
              :agent="agent"
              :busy="market.busyAgentId.value === agent.agentId"
              @recruit="market.recruit"
              @open="market.openDirectory"
              @dismiss="market.dismiss"
              @chat="openChat"
            />
          </div>
          <AgentCatalogSkeleton v-else-if="catalog.loading.value" dense />
          <div
            v-else-if="searching"
            class="rounded-xl border border-dashed border-rule bg-background px-4 py-8 text-center"
          >
            <p class="m-0 text-sm text-muted-foreground">{{ t("agentsNoMatch") }}</p>
          </div>
          <div
            v-else
            class="rounded-xl border border-dashed border-rule bg-background px-4 py-8 text-center"
          >
            <p class="m-0 text-sm text-muted-foreground">{{ t("agentsEmptyMarket") }}</p>
          </div>
          <div v-if="agentsHasMore" class="mt-2 flex justify-end">
            <RouterLink
              class="inline-flex min-h-8 items-center gap-1 text-sm font-semibold text-accent no-underline hover:text-accent-deep"
              :to="{ name: 'market-agents', query: query.trim() ? { q: query.trim() } : undefined }"
            >
              {{ t("marketViewMore") }}
              <ChevronRightIcon class="size-3.5" aria-hidden="true" />
            </RouterLink>
          </div>
        </section>
      </div>
    </div>
  </main>
</template>
