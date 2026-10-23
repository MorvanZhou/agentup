import { ref, watch, type Ref } from "vue";

import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { AgentCard, Session } from "../../../shared/model/runtime";
import { isGuestSession } from "../../../shared/model/session";
import { showToast } from "../../../shared/model/toast";
import { t } from "../../../shared/model/ui-locale";
import type { AgentsSection } from "../components/sidebar/AgentsSidebar.vue";

const DEBOUNCE_MS = 250;

export type CatalogSection = AgentsSection | "market";

export function useAgentCatalog(
  session: Ref<Session | null>,
  section: Ref<CatalogSection>,
  query: Ref<string>,
  api = new DesktopApi(),
) {
  const agents = ref<AgentCard[]>([]);
  const loading = ref(false);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let requestSeq = 0;

  async function reload(): Promise<void> {
    const current = session.value;
    if (!current || section.value === "assistant") {
      agents.value = [];
      loading.value = false;
      return;
    }
    const guest = isGuestSession(current);
    if (guest && (section.value === "recruited" || section.value === "owned")) {
      agents.value = [];
      loading.value = false;
      return;
    }
    const seq = ++requestSeq;
    loading.value = true;
    try {
      const q = query.value.trim();
      let next: AgentCard[];
      if (section.value === "local") {
        next = await api.localAgents(current.token, current.userId, { q });
      } else if (guest || section.value === "market") {
        next = guest
          ? await api.publicAgents({ q })
          : await api.agents(current.token, { userId: current.userId, q });
      } else if (section.value === "owned") {
        next = await api.ownedAgents(current.token, { userId: current.userId, q });
      } else {
        next = await api.agents(current.token, {
          userId: current.userId,
          q,
          recruited: true,
        });
      }
      if (seq === requestSeq) agents.value = next;
    } catch (caught) {
      if (seq !== requestSeq) return;
      showToast(caught instanceof DesktopApiError ? caught.message : t("agentsLoadFailed"), "error");
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
    [() => session.value?.token, () => session.value?.userId, () => session.value?.kind, section],
    () => {
      clearTimeout(debounceTimer);
      // 换分区 / 换身份时立刻清空，避免短暂展示上一区的卡片且「加载中」不出现
      agents.value = [];
      void reload();
    },
    { immediate: true },
  );

  watch(query, () => {
    scheduleReload();
  });

  return { agents, loading, reload };
}
