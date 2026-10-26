<script setup lang="ts">
import { ChevronDownIcon, SearchIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApi } from "../../api/runtime";
import { detailsOf, formatApiError } from "../../model/runtime/package-issues";
import type {
  CommunitySkillHit,
  CommunitySkillSort,
  CommunitySkillSource,
  PackageIssue,
} from "../../model/runtime/runtime";
import { t } from "../../model/ui/ui-locale";
import AppDialog from "../AppDialog.vue";
import AppDropdownMenu, { type AppDropdownItem } from "../AppDropdownMenu.vue";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  /** 已下载到本机临时 zip，由调用方安装或加入待装路径 */
  fetched: [path: string, hit: CommunitySkillHit];
}>();

const api = new DesktopApi();
const { session } = useDesktop();

const source = ref<CommunitySkillSource>("skillhub");
const sort = ref<CommunitySkillSort>("downloads");
const query = ref("");
const hits = ref<CommunitySkillHit[]>([]);
const searching = ref(false);
const installingId = ref<string | null>(null);
const error = ref("");
const errorDetails = ref<PackageIssue[]>([]);
const searched = ref(false);
let searchSeq = 0;

const sourceItems = computed((): AppDropdownItem[] => [
  { id: "skillhub", label: t("skillsCommunitySourceSkillhub") },
  { id: "clawhub", label: t("skillsCommunitySourceClawhub") },
]);

const sortItems = computed((): AppDropdownItem[] => [
  { id: "downloads", label: t("skillsCommunitySortDownloads") },
  { id: "updated", label: t("skillsCommunitySortUpdated") },
]);

const sourceLabel = computed(() =>
  source.value === "clawhub"
    ? t("skillsCommunitySourceClawhub")
    : t("skillsCommunitySourceSkillhub"),
);

const sortLabel = computed(() =>
  sort.value === "updated"
    ? t("skillsCommunitySortUpdated")
    : t("skillsCommunitySortDownloads"),
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    query.value = "";
    error.value = "";
    errorDetails.value = [];
    installingId.value = null;
    searched.value = false;
    hits.value = [];
    void runSearch();
  },
);

watch([source, sort], () => {
  if (!props.open) return;
  void runSearch();
});

function onSourceSelect(id: string): void {
  if (id !== "skillhub" && id !== "clawhub") return;
  if (source.value === id) return;
  source.value = id;
}

function onSortSelect(id: string): void {
  if (id !== "downloads" && id !== "updated") return;
  if (sort.value === id) return;
  sort.value = id;
}

async function runSearch(): Promise<void> {
  if (!session.value) return;
  const seq = ++searchSeq;
  searching.value = true;
  error.value = "";
  errorDetails.value = [];
  try {
    const list = await api.searchCommunitySkills(
      session.value.token,
      source.value,
      query.value.trim(),
      { sort: sort.value },
    );
    if (seq !== searchSeq) return;
    hits.value = list;
    searched.value = true;
  } catch (caught) {
    if (seq !== searchSeq) return;
    hits.value = [];
    searched.value = true;
    error.value = formatApiError(caught, t("skillsCommunitySearchFailed"));
    errorDetails.value = detailsOf(caught);
  } finally {
    if (seq === searchSeq) searching.value = false;
  }
}

function onSearchSubmit(event: Event): void {
  event.preventDefault();
  void runSearch();
}

async function installHit(hit: CommunitySkillHit): Promise<void> {
  if (!session.value || installingId.value) return;
  installingId.value = hit.id;
  error.value = "";
  errorDetails.value = [];
  try {
    const path = await api.fetchCommunitySkill(session.value.token, {
      source: hit.source,
      slug: hit.slug,
      ...(hit.owner ? { owner: hit.owner } : {}),
      ...(hit.version ? { version: hit.version } : {}),
    });
    emit("fetched", path, hit);
    emit("update:open", false);
  } catch (caught) {
    error.value = formatApiError(caught, t("skillsCommunityInstallFailed"));
    errorDetails.value = detailsOf(caught);
  } finally {
    installingId.value = null;
  }
}

function formatDownloads(value: number | undefined): string {
  if (value === undefined) return "";
  if (value >= 10_000) return `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return String(value);
}
</script>

<template>
  <AppDialog
    :open="open"
    :title="t('skillsCommunityTitle')"
    :description="t('skillsCommunityLead')"
    size="lg"
    @update:open="$emit('update:open', $event)"
  >
    <!-- 搜索与源切换 -->
    <form class="flex flex-col gap-2 sm:flex-row sm:items-center" @submit="onSearchSubmit">
      <div class="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-rule bg-paper px-2.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
        <SearchIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          v-model="query"
          type="search"
          class="min-h-8 min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          :placeholder="t('skillsCommunitySearchPlaceholder')"
          :disabled="searching || !!installingId"
          autocomplete="off"
        />
      </div>
      <AppDropdownMenu :items="sourceItems" align="end" @select="onSourceSelect">
        <template #trigger>
          <button
            type="button"
            class="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-rule bg-paper px-2.5 text-sm text-foreground transition hover:bg-paper-deep disabled:opacity-50"
            :disabled="searching || !!installingId"
            :aria-label="t('skillsCommunitySourceAria')"
          >
            <span class="max-w-36 truncate">{{ sourceLabel }}</span>
            <ChevronDownIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </template>
      </AppDropdownMenu>
      <AppDropdownMenu :items="sortItems" align="end" @select="onSortSelect">
        <template #trigger>
          <button
            type="button"
            class="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-rule bg-paper px-2.5 text-sm text-foreground transition hover:bg-paper-deep disabled:opacity-50"
            :disabled="searching || !!installingId"
            :aria-label="t('skillsCommunitySortAria')"
          >
            <span class="max-w-28 truncate">{{ sortLabel }}</span>
            <ChevronDownIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </template>
      </AppDropdownMenu>
      <button
        type="submit"
        class="inline-flex min-h-8 shrink-0 items-center justify-center rounded-lg bg-accent px-3 text-sm font-semibold text-white transition hover:bg-accent-deep disabled:opacity-50"
        :disabled="searching || !!installingId"
      >
        {{ t("skillsCommunitySearch") }}
      </button>
    </form>

    <div v-if="error" class="mt-3 rounded-lg border border-destructive/20 bg-danger-soft px-3 py-2.5">
      <p class="m-0 whitespace-pre-wrap break-words text-sm text-destructive">{{ error }}</p>
      <ul v-if="errorDetails.length" class="mb-0 mt-2 list-none space-y-1.5 p-0">
        <li
          v-for="(detail, index) in errorDetails"
          :key="`${detail.path}-${index}`"
          class="rounded-md border border-rule bg-paper px-2.5 py-2"
        >
          <code class="break-all text-xs font-semibold text-destructive">{{ detail.path }}</code>
          <p class="mb-0 mt-1 text-xs leading-snug text-foreground">{{ detail.message }}</p>
        </li>
      </ul>
    </div>

    <div class="mt-3 min-h-48">
      <p v-if="searching" class="m-0 text-sm text-muted-foreground">{{ t("skillsCommunitySearching") }}</p>
      <p
        v-else-if="searched && !hits.length"
        class="m-0 text-sm text-muted-foreground"
      >{{ t("skillsCommunityEmpty") }}</p>
      <ul v-else class="m-0 flex list-none flex-col gap-2 p-0">
        <li
          v-for="hit in hits"
          :key="hit.id"
          class="flex items-start justify-between gap-3 rounded-xl border border-rule bg-paper px-3 py-2.5"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p class="m-0 truncate text-sm font-medium text-foreground">{{ hit.name }}</p>
              <p class="m-0 truncate font-mono text-xs text-muted-foreground">
                {{ hit.owner ? `${hit.owner}/${hit.slug}` : hit.slug }}
              </p>
            </div>
            <p
              v-if="hit.description"
              class="mb-0 mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground"
            >{{ hit.description }}</p>
            <p class="mb-0 mt-1.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              <span v-if="hit.version">v{{ hit.version }}</span>
              <span v-if="hit.downloads !== undefined">
                {{ t("skillsCommunityDownloads", { count: formatDownloads(hit.downloads) }) }}
              </span>
            </p>
          </div>
          <button
            type="button"
            class="inline-flex min-h-8 shrink-0 items-center rounded-lg bg-accent px-2.5 text-xs font-semibold text-white transition hover:bg-accent-deep disabled:opacity-50"
            :disabled="!!installingId || searching"
            @click="installHit(hit)"
          >
            {{ installingId === hit.id ? t("skillsCommunityInstalling") : t("skillsCommunityInstall") }}
          </button>
        </li>
      </ul>
    </div>
  </AppDialog>
</template>
