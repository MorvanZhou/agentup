import { ref, type Ref } from "vue";

import { runWithAccount } from "../../../app/auth-gate";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { Session } from "../../../shared/model/runtime/runtime";
import { isGuestSession } from "../../../shared/model/session/session";
import { showToast } from "../../../shared/model/ui/toast";

export function useAgentMarket(
  session: Ref<Session | null>,
  refresh: () => Promise<void>,
  api = new DesktopApi(),
) {
  const busyAgentId = ref("");

  async function recruit(agentId: string): Promise<void> {
    if (!session.value || busyAgentId.value) return;
    await runWithAccount("agent.recruit", async () => {
      const current = session.value;
      if (!current || isGuestSession(current) || busyAgentId.value) return;
      busyAgentId.value = agentId;
      try {
        await api.recruit(current.token, agentId);
        await api.sync(current.token, agentId, current.userId);
        await refresh();
      } catch (caught) {
        showToast(messageOf(caught), "error");
      } finally {
        busyAgentId.value = "";
      }
    });
  }

  async function openDirectory(agentId: string): Promise<void> {
    if (!session.value || busyAgentId.value) return;
    busyAgentId.value = agentId;
    try {
      const directory = await api.visitDirectory(session.value.token, agentId, session.value.userId);
      if (!window.agentUp?.openVisitDirectory) {
        showToast("请在 AgentUp 桌面应用中打开目录", "error");
        return;
      }
      await window.agentUp.openVisitDirectory(directory);
    } catch (caught) {
      showToast(caught instanceof Error && caught.message ? caught.message : messageOf(caught), "error");
    } finally {
      busyAgentId.value = "";
    }
  }

  async function dismiss(agentId: string): Promise<void> {
    if (!session.value || busyAgentId.value) return;
    busyAgentId.value = agentId;
    try {
      await api.dismiss(session.value.token, agentId, session.value.userId);
      await refresh();
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      busyAgentId.value = "";
    }
  }

  return { busyAgentId, recruit, openDirectory, dismiss };
}

function messageOf(caught: unknown): string {
  return caught instanceof DesktopApiError ? caught.message : "请求失败";
}
