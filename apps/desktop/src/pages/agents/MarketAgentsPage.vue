<script setup lang="ts">
import { ArrowLeftIcon, PlusIcon, SearchIcon } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { useDesktop } from "../../app/desktop";
import type { AgentCard } from "../../shared/model/runtime/runtime";
import { SEARCH_QUERY_MAX } from "../../shared/model/input-limits";
import { t } from "../../shared/model/ui/ui-locale";
import AgentCatalogSkeleton from "./components/AgentCatalogSkeleton.vue";
import AgentMarketCard from "./components/market/AgentMarketCard.vue";
import { useAgentCatalog } from "./composables/useAgentCatalog";
import { useAgentMarket } from "./composables/useAgentMarket";

const route = useRoute();
const router = useRouter();
const { session, refresh, select } = useDesktop();
const query = ref("");
const section = computed(() => "market" as const);
const catalog = useAgentCatalog(session, section, query);
const market = useAgentMarket(session, async () => {
  await refresh();
  await catalog.reload();
});
const searching = computed(() => Boolean(query.value.trim()));

onMounted(() => {
  const raw = route.query.q;
  if (typeof raw === "string" && raw.trim()) query.value = raw.trim().slice(0, SEARCH_QUERY_MAX);
});

function openChat(agent: AgentCard): void {
  select(agent);
  void router.push({ name: "conversation" });
}
</script>

<template>
  <main class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <!-- Agent 市场全量列表 -->
    <header
      class="app-drag flex h-12 shrink-0 items-center justify-between gap-3 border-b border-rule bg-paper-deep px-4"
    >
      <div class="app-no-drag flex min-w-0 items-center gap-2">
        <RouterLink
          class="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground no-underline outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
          :to="{ name: 'market' }"
          :aria-label="t('marketBackOverview')"
        >
          <ArrowLeftIcon class="size-4" aria-hidden="true" />
        </RouterLink>
        <h1 class="m-0 min-w-0 truncate text-base font-semibold tracking-tight text-foreground">
          {{ t("marketAgentsTitle") }}
        </h1>
      </div>
      <div class="app-no-drag flex min-w-0 shrink items-center gap-2">
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
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-auto">
      <div class="mx-auto w-full max-w-7xl px-4 py-4 sm:px-5 sm:py-5">
        <!-- 发布钮在卡片网格左上 -->
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
          v-if="catalog.agents.value.length"
          class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        >
          <AgentMarketCard
            v-for="agent in catalog.agents.value"
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
          class="rounded-xl border border-dashed border-rule bg-background px-4 py-10 text-center"
        >
          <p class="m-0 text-sm text-muted-foreground">{{ t("agentsNoMatch") }}</p>
        </div>
        <div
          v-else
          class="rounded-xl border border-dashed border-rule bg-background px-4 py-10 text-center"
        >
          <p class="m-0 text-sm text-muted-foreground">{{ t("agentsEmptyMarket") }}</p>
        </div>
      </div>
    </div>
  </main>
</template>
