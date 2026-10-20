<script setup lang="ts">
import { SearchIcon } from "@lucide/vue";
import { computed, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { useDesktop } from "../../app/desktop";
import { t, tf } from "../../shared/model/ui-locale";
import PublishedAgentCard from "../publish/components/PublishedAgentCard.vue";
import AgentMarketCard from "./components/AgentMarketCard.vue";
import AgentsSidebar, { type AgentsTab } from "./components/AgentsSidebar.vue";
import { useAgentCatalog } from "./composables/useAgentCatalog";
import { useAgentMarket } from "./composables/useAgentMarket";

const route = useRoute();
const router = useRouter();
const { session, refresh } = useDesktop();
const query = ref("");

const tab = computed<AgentsTab>(() => {
  const raw = route.query.tab;
  if (raw === "recruited" || raw === "owned") return raw;
  return "market";
});

const title = computed(() => {
  if (tab.value === "recruited") return t("agentsTabRecruited");
  if (tab.value === "owned") return t("agentsTabOwned");
  return t("agentsTabMarket");
});
const catalog = useAgentCatalog(session, tab, query);
const market = useAgentMarket(session, async () => {
  await refresh();
  await catalog.reload();
});

const searching = computed(() => Boolean(query.value.trim()));

function selectTab(next: AgentsTab): void {
  query.value = "";
  void router.replace({
    name: "agents",
    query: next === "market" ? {} : { tab: next },
  });
}
</script>

<template>
  <div
    class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background min-[730px]:grid-cols-[11rem_minmax(0,1fr)] min-[730px]:grid-rows-1"
  >
    <!-- 市场侧栏 -->
    <aside class="flex min-h-0 min-w-0 flex-col border-r border-rule bg-paper text-foreground">
      <AgentsSidebar :tab="tab" @select="selectTab" />
    </aside>

    <!-- Agent 列表主区 -->
    <main class="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <!-- 页头 -->
      <header
        class="app-drag flex h-12 shrink-0 items-center justify-between gap-3 border-b border-rule bg-paper-deep px-4"
      >
        <h1 class="m-0 min-w-0 truncate text-base font-semibold tracking-tight text-foreground">{{ title }}</h1>
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
              :placeholder="t('agentsSearchPlaceholder')"
              class="min-h-8 w-full rounded-lg border border-rule bg-paper py-1.5 pr-2.5 pl-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </label>
          <RouterLink
            class="inline-flex min-h-8 shrink-0 items-center justify-center rounded-lg bg-accent px-3 text-sm font-semibold text-white no-underline transition duration-200 hover:bg-accent-deep"
            :to="{ name: 'publish-new' }"
          >
            {{ t("agentsPublish") }}
          </RouterLink>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-auto">
        <div class="mx-auto w-full max-w-6xl px-4 py-4 sm:px-5 sm:py-5">
          <!-- 市场 / 已招募 -->
          <section v-if="tab !== 'owned'" class="min-w-0" :aria-label="title">
            <div v-if="catalog.agents.value.length" class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <AgentMarketCard
                v-for="agent in catalog.agents.value"
                :key="agent.agentId"
                :agent="agent"
                :busy="market.busyAgentId.value === agent.agentId"
                @recruit="market.recruit"
                @open="market.openDirectory"
                @dismiss="market.dismiss"
              />
            </div>
            <!-- 空状态 -->
            <div
              v-else-if="!catalog.loading.value && searching"
              class="rounded-xl border border-dashed border-rule bg-background px-4 py-10 text-center"
            >
              <p class="m-0 text-sm text-muted-foreground">{{ t("agentsNoMatch") }}</p>
            </div>
            <div
              v-else-if="!catalog.loading.value"
              class="rounded-xl border border-dashed border-rule bg-background px-4 py-10 text-center"
            >
              <p class="m-0 text-sm text-muted-foreground">
                {{ tab === "recruited" ? t("agentsEmptyRecruited") : t("agentsEmptyMarket") }}
              </p>
              <button
                v-if="tab === 'recruited'"
                type="button"
                class="mt-3 inline-flex min-h-8 items-center border-0 bg-transparent text-sm font-semibold text-accent transition duration-200 hover:text-accent-deep"
                @click="selectTab('market')"
              >
                {{ t("agentsGoMarket") }}
              </button>
              <RouterLink
                v-else
                class="mt-3 inline-flex min-h-8 items-center text-sm font-semibold text-accent no-underline transition duration-200 hover:text-accent-deep"
                :to="{ name: 'publish-new' }"
              >
                {{ t("agentsPublishFirst") }}
              </RouterLink>
            </div>
          </section>

          <!-- 我发布的 -->
          <section v-else class="min-w-0" :aria-label="t('agentsTabOwned')">
            <div v-if="catalog.agents.value.length" class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <RouterLink
                v-for="agent in catalog.agents.value"
                :key="agent.agentId"
                class="group flex h-full min-w-0 text-inherit no-underline outline-none focus-visible:rounded-xl focus-visible:ring-2 focus-visible:ring-accent/40"
                :aria-label="tf('agentsUpdateAria', { name: agent.name })"
                :to="{ name: 'publish-edit', params: { agentId: agent.agentId } }"
              >
                <PublishedAgentCard :agent="agent" />
              </RouterLink>
            </div>
            <!-- 空状态 -->
            <div
              v-else-if="!catalog.loading.value && searching"
              class="rounded-xl border border-dashed border-rule bg-background px-4 py-10 text-center"
            >
              <p class="m-0 text-sm text-muted-foreground">{{ t("agentsNoMatch") }}</p>
            </div>
            <div
              v-else-if="!catalog.loading.value"
              class="rounded-xl border border-dashed border-rule bg-background px-4 py-10 text-center"
            >
              <p class="m-0 text-sm text-muted-foreground">{{ t("agentsEmptyOwned") }}</p>
              <RouterLink
                class="mt-3 inline-flex min-h-8 items-center text-sm font-semibold text-accent no-underline transition duration-200 hover:text-accent-deep"
                :to="{ name: 'publish-new' }"
              >
                {{ t("agentsPublishFirstShort") }}
              </RouterLink>
            </div>
          </section>
        </div>
      </div>
    </main>
  </div>
</template>
