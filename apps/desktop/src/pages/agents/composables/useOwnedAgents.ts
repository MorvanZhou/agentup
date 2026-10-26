import { ref, type Ref } from "vue";

import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { Session } from "../../../shared/model/runtime/runtime";
import { showToast } from "../../../shared/model/ui/toast";
import { t } from "../../../shared/model/ui/ui-locale";

export function useOwnedAgents(
  session: Ref<Session | null>,
  reloadCatalog: () => Promise<void>,
  api = new DesktopApi(),
) {
  const busyAgentId = ref("");

  async function remove(agentId: string): Promise<void> {
    if (!session.value || busyAgentId.value) return;
    busyAgentId.value = agentId;
    try {
      await api.deleteOwnedAgent(session.value.token, agentId, session.value.userId);
      await reloadCatalog();
      showToast(t("publishDeleted"), "success");
    } catch (caught) {
      showToast(caught instanceof DesktopApiError ? caught.message : t("agentsLocalRequestFailed"), "error");
    } finally {
      busyAgentId.value = "";
    }
  }

  return { busyAgentId, remove };
}
