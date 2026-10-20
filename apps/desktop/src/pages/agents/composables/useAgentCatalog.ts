import { ref, watch, type Ref } from "vue";

import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { AgentCard, Session } from "../../../shared/model/runtime";
import { isGuestSession } from "../../../shared/model/session";
import { showToast } from "../../../shared/model/toast";
import type { AgentsTab } from "../components/AgentsSidebar.vue";

const DEBOUNCE_MS = 250;

export function useAgentCatalog(
  session: Ref<Session | null>,
  tab: Ref<AgentsTab>,
  query: Ref<string>,
  api = new DesktopApi(),
) {
  const agents = ref<AgentCard[]>([]);
  const loading = ref(false);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let requestSeq = 0;

  async function reload(): Promise<void> {
    const current = session.value;
    if (!current) {
      agents.value = [];
      loading.value = false;
      return;
    }
    const guest = isGuestSession(current);
    if (guest && tab.value !== "market") {
      agents.value = [];
      loading.value = false;
      return;
    }
    const seq = ++requestSeq;
    loading.value = true;
    try {
      const q = query.value.trim();
      const next = guest
        ? await api.publicAgents({ q })
        : tab.value === "owned"
          ? await api.ownedAgents(current.token, { q })
          : await api.agents(current.token, {
              userId: current.userId,
              q,
              recruited: tab.value === "recruited" ? true : undefined,
            });
      if (seq === requestSeq) agents.value = next;
    } catch (caught) {
      if (seq !== requestSeq) return;
      showToast(caught instanceof DesktopApiError ? caught.message : "加载 Agent 失败");
      agents.value = [];
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
    [() => session.value?.token, () => session.value?.userId, () => session.value?.kind, tab],
    () => {
      clearTimeout(debounceTimer);
      void reload();
    },
    { immediate: true },
  );

  watch(query, () => {
    scheduleReload();
  });

  return { agents, loading, reload };
}
