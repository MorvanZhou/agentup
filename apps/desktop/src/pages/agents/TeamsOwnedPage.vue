<script setup lang="ts">
import { PlusIcon, SearchIcon } from "@lucide/vue";
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";

import { useDesktop } from "../../app/desktop";
import { DesktopApi, DesktopApiError } from "../../shared/api/runtime";
import { SEARCH_QUERY_MAX } from "../../shared/model/input-limits";
import { showToast } from "../../shared/model/ui/toast";
import { t } from "../../shared/model/ui/ui-locale";
import AgentCatalogSkeleton from "./components/AgentCatalogSkeleton.vue";
import OwnedTeamCard from "./components/owned/OwnedTeamCard.vue";
import AgentsSidebar from "./components/sidebar/AgentsSidebar.vue";
import { useTeamCatalog } from "./composables/useTeamCatalog";

const { session, refresh } = useDesktop();
const api = new DesktopApi();
const query = ref("");
const scope = computed(() => "owned" as const);
const catalog = useTeamCatalog(session, scope, query);
const busyId = ref("");
const searching = computed(() => Boolean(query.value.trim()));

async function remove(teamId: string): Promise<void> {
  const current = session.value;
  if (!current || busyId.value) return;
  busyId.value = teamId;
  try {
    await api.deleteTeam(current.token, teamId);
    await refresh();
    await catalog.reload();
    showToast(t("teamsDeleted"), "success");
  } catch (caught) {
    showToast(caught instanceof DesktopApiError ? caught.message : t("teamsDeleteFailed"), "error");
  } finally {
    busyId.value = "";
  }
}
</script>

<template>
  <div
    class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background min-[730px]:grid-cols-[11rem_minmax(0,1fr)] min-[730px]:grid-rows-1"
  >
    <!-- Agents 管理侧栏：含「我的团队」 -->
    <aside class="flex min-h-0 min-w-0 flex-col border-r border-rule bg-paper text-foreground">
      <AgentsSidebar section="teams" />
    </aside>

    <main class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <header
        class="app-drag flex h-12 shrink-0 items-center justify-between gap-3 border-b border-rule bg-paper-deep px-4"
      >
        <h1 class="m-0 min-w-0 truncate text-base font-semibold tracking-tight text-foreground">
          {{ t("teamsOwnedTitle") }}
        </h1>
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
              class="min-h-8 w-full rounded-lg border border-rule bg-paper py-1.5 pr-2.5 pl-8 text-sm outline-none placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </label>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-auto">
        <div class="mx-auto w-full max-w-7xl px-4 py-4 sm:px-5 sm:py-5">
          <!-- 与「我发布的」一致：发布钮在卡片网格左上 -->
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
            v-if="catalog.teams.value.length"
            class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          >
            <OwnedTeamCard
              v-for="team in catalog.teams.value"
              :key="team.teamId"
              :team="team"
              :busy="busyId === team.teamId"
              @remove="remove"
            />
          </div>
          <AgentCatalogSkeleton v-else-if="catalog.loading.value" dense />
          <div
            v-else-if="searching"
            class="rounded-xl border border-dashed border-rule bg-background px-4 py-10 text-center"
          >
            <p class="m-0 text-sm text-muted-foreground">{{ t("teamsNoMatch") }}</p>
          </div>
          <div
            v-else
            class="rounded-xl border border-dashed border-rule bg-background px-4 py-10 text-center"
          >
            <p class="m-0 text-sm text-muted-foreground">{{ t("teamsEmptyOwned") }}</p>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
