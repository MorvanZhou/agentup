import { ref, watch, type Ref } from "vue";

import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { Session, TeamCard } from "../../../shared/model/runtime/runtime";
import { isGuestSession } from "../../../shared/model/session/session";
import { showToast } from "../../../shared/model/ui/toast";
import { t } from "../../../shared/model/ui/ui-locale";

const DEBOUNCE_MS = 250;

export type TeamCatalogScope = "market" | "owned";

export function useTeamCatalog(
  session: Ref<Session | null>,
  scope: Ref<TeamCatalogScope>,
  query: Ref<string>,
  api = new DesktopApi(),
) {
  const teams = ref<TeamCard[]>([]);
  const loading = ref(false);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let requestSeq = 0;

  async function reload(): Promise<void> {
    const current = session.value;
    if (!current) {
      teams.value = [];
      loading.value = false;
      return;
    }
    const guest = isGuestSession(current);
    if (guest && scope.value === "owned") {
      teams.value = [];
      loading.value = false;
      return;
    }
    const seq = ++requestSeq;
    loading.value = true;
    try {
      const q = query.value.trim();
      let next: TeamCard[];
      if (scope.value === "owned") {
        next = await api.ownedTeams(current.token, { q });
      } else if (guest) {
        next = await api.publicTeams({ q });
      } else {
        next = await api.teams(current.token, { q });
      }
      if (seq === requestSeq) teams.value = next;
    } catch (caught) {
      if (seq !== requestSeq) return;
      showToast(caught instanceof DesktopApiError ? caught.message : t("teamsLoadFailed"), "error");
      teams.value = [];
    } finally {
      if (seq === requestSeq) loading.value = false;
    }
  }

  function scheduleReload(): void {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void reload();
    }, DEBOUNCE_MS);
  }

  watch(
    [() => session.value?.token, () => session.value?.userId, () => session.value?.kind, scope],
    () => {
      clearTimeout(debounceTimer);
      teams.value = [];
      void reload();
    },
    { immediate: true },
  );

  watch(query, () => scheduleReload());

  return { teams, loading, reload };
}
