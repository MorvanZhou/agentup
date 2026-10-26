<script setup lang="ts">
import { PlusIcon, SearchIcon } from "@lucide/vue";
import { computed, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { useDesktop } from "../../app/desktop";
import { isGuestSession } from "../../shared/model/session/session";
import { t } from "../../shared/model/ui/ui-locale";
import PublishedAgentCard from "./components/owned/PublishedAgentCard.vue";
import AgentCatalogSkeleton from "./components/AgentCatalogSkeleton.vue";
import LocalAgentCard from "./components/local/LocalAgentCard.vue";
import AgentMarketCard from "./components/market/AgentMarketCard.vue";
import AgentsSidebar, { type AgentsSection } from "./components/sidebar/AgentsSidebar.vue";
import { useAgentCatalog } from "./composables/useAgentCatalog";
import { useAgentMarket } from "./composables/useAgentMarket";
import { useLocalAgents } from "./composables/useLocalAgents";
import { useOwnedAgents } from "./composables/useOwnedAgents";
import AssistantPage from "./AssistantPage.vue";

const route = useRoute();
const router = useRouter();
const { session, refresh } = useDesktop();
const query = ref("");

const section = computed<AgentsSection>(() => {
  const name = route.name;
  if (name === "agents-local") return "local";
  if (name === "agents-recruited") return "recruited";
  if (name === "agents-owned") return "owned";
  return "assistant";
});

const title = computed(() => {
  if (section.value === "local") return t("agentsSectionLocal");
  if (section.value === "recruited") return t("agentsSectionRecruited");
  if (section.value === "owned") return t("agentsSectionOwned");
  return t("agentsSectionAssistant");
});

const catalog = useAgentCatalog(session, section, query);
const market = useAgentMarket(session, async () => {
  await refresh();
  await catalog.reload();
});
const local = useLocalAgents(session, catalog.reload);
const owned = useOwnedAgents(session, catalog.reload);

const searching = computed(() => Boolean(query.value.trim()));
const showListChrome = computed(() => section.value !== "assistant");
const guestLocked = computed(
  () =>
    Boolean(session.value && isGuestSession(session.value)) &&
    (section.value === "recruited" || section.value === "owned"),
);

function goMarket(): void {
  void router.push({ name: "market" });
}

function openOwnedEdit(agentId: string): void {
  void router.push({ name: "agents-owned-edit", params: { agentId } });
}
</script>

<template>
  <div
    class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background min-[730px]:grid-cols-[11rem_minmax(0,1fr)] min-[730px]:grid-rows-1"
  >
    <!-- Agents 管理侧栏 -->
    <aside class="flex min-h-0 min-w-0 flex-col border-r border-rule bg-paper text-foreground">
      <AgentsSidebar :section="section" />
    </aside>

    <!-- 管理主区 -->
    <main class="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <header
        class="app-drag flex h-12 shrink-0 items-center justify-between gap-3 border-b border-rule bg-paper-deep px-4"
      >
        <h1 class="m-0 min-w-0 truncate text-base font-semibold tracking-tight text-foreground">{{ title }}</h1>
        <div v-if="showListChrome" class="app-no-drag flex min-w-0 shrink items-center gap-2">
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
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-auto">
        <div
          class="mx-auto w-full px-4 py-4 sm:px-5 sm:py-5"
          :class="section === 'assistant' ? 'max-w-2xl' : 'max-w-7xl'"
        >
          <!-- 我的助理 -->
          <section v-if="section === 'assistant'" class="min-w-0" :aria-label="title">
            <header class="mb-5">
              <p class="m-0 text-xs font-medium tracking-wider text-accent">{{ t("assistantKicker") }}</p>
              <p class="mb-0 mt-1.5 max-w-xl text-sm leading-snug text-muted-foreground">
                {{ t("assistantLead") }}
              </p>
            </header>
            <AssistantPage />
          </section>

          <!-- 游客锁定：已招募 / 我发布的 -->
          <section
            v-else-if="guestLocked"
            class="rounded-xl border border-dashed border-rule bg-background px-4 py-10 text-center"
            :aria-label="title"
          >
            <p class="m-0 text-sm text-muted-foreground">{{ t("agentsGuestLocked") }}</p>
          </section>

          <!-- 本机 -->
          <section v-else-if="section === 'local'" class="min-w-0" :aria-label="title">
            <div class="mb-3 flex items-center justify-start">
              <RouterLink
                class="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-white no-underline transition duration-200 hover:bg-accent-deep"
                :to="{ name: 'agents-local-new' }"
              >
                <PlusIcon class="size-3.5" aria-hidden="true" />
                {{ t("agentsLocalNew") }}
              </RouterLink>
            </div>
            <div
              v-if="catalog.agents.value.length"
              class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
            >
              <LocalAgentCard
                v-for="agent in catalog.agents.value"
                :key="agent.agentId"
                :agent="agent"
                :busy="local.busyAgentId.value === agent.agentId"
                @chat="local.openChat"
                @edit="local.openEdit"
                @open="local.openDirectory"
                @publish="local.publish"
                @remove="local.remove"
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
              <p class="m-0 text-sm text-muted-foreground">{{ t("agentsEmptyLocal") }}</p>
              <RouterLink
                class="mt-3 inline-flex min-h-8 items-center text-sm font-semibold text-accent no-underline transition duration-200 hover:text-accent-deep"
                :to="{ name: 'agents-local-new' }"
              >
                {{ t("agentsLocalCreateFirst") }}
              </RouterLink>
            </div>
          </section>

          <!-- 已招募 -->
          <section v-else-if="section === 'recruited'" class="min-w-0" :aria-label="title">
            <div
              v-if="catalog.agents.value.length"
              class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
            >
              <AgentMarketCard
                v-for="agent in catalog.agents.value"
                :key="agent.agentId"
                surface="manage"
                :agent="agent"
                :busy="market.busyAgentId.value === agent.agentId"
                @recruit="market.recruit"
                @open="market.openDirectory"
                @dismiss="market.dismiss"
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
              <p class="m-0 text-sm text-muted-foreground">{{ t("agentsEmptyRecruited") }}</p>
              <button
                type="button"
                class="mt-3 inline-flex min-h-8 items-center border-0 bg-transparent text-sm font-semibold text-accent transition duration-200 hover:text-accent-deep"
                @click="goMarket"
              >
                {{ t("agentsGoMarket") }}
              </button>
            </div>
          </section>

          <!-- 我发布的 -->
          <section v-else class="min-w-0" :aria-label="title">
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
              <PublishedAgentCard
                v-for="agent in catalog.agents.value"
                :key="agent.agentId"
                :agent="agent"
                :busy="owned.busyAgentId.value === agent.agentId"
                @update="openOwnedEdit"
                @remove="owned.remove"
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
              <p class="m-0 text-sm text-muted-foreground">{{ t("agentsEmptyOwned") }}</p>
              <RouterLink
                class="mt-3 inline-flex min-h-8 items-center text-sm font-semibold text-accent no-underline transition duration-200 hover:text-accent-deep"
                :to="{ name: 'agents-owned-new' }"
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
