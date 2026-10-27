import { ref, type Ref } from "vue";
import { useRouter } from "vue-router";

import { runWithAccount } from "../../../app/auth/auth-gate";
import { useDesktop } from "../../../app/desktop";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { AgentCard, Session } from "../../../shared/model/runtime/runtime";
import { isGuestSession } from "../../../shared/model/session/session";
import { showToast } from "../../../shared/model/ui/toast";
import { t, tf } from "../../../shared/model/ui/ui-locale";

export function useLocalAgents(
  session: Ref<Session | null>,
  reloadCatalog: () => Promise<void>,
  api = new DesktopApi(),
) {
  const router = useRouter();
  const { select, refresh } = useDesktop();
  const busyAgentId = ref("");
  const creating = ref(false);
  const saving = ref(false);

  async function create(input: {
    name: string;
    role: string;
    background: string;
    rules?: string;
    skillPaths?: string[];
    mcpServers?: Record<string, unknown>;
  }): Promise<AgentCard | null> {
    if (!session.value || creating.value) return null;
    creating.value = true;
    try {
      const card = await api.createLocalAgent(session.value.token, session.value.userId, input);
      await refresh();
      await reloadCatalog();
      showToast(t("agentsLocalCreated"), "success");
      return card;
    } catch (caught) {
      showToast(messageOf(caught), "error");
      return null;
    } finally {
      creating.value = false;
    }
  }

  async function load(agentId: string): Promise<AgentCard | null> {
    if (!session.value) return null;
    try {
      return await api.getLocalAgent(session.value.token, session.value.userId, agentId);
    } catch (caught) {
      showToast(messageOf(caught), "error");
      return null;
    }
  }

  async function update(
    agentId: string,
    input: {
      name: string;
      role: string;
      background: string;
      rules?: string;
      skillPaths?: string[];
      removeSkills?: string[];
      mcpServers?: Record<string, unknown>;
    },
  ): Promise<AgentCard | null> {
    if (!session.value || saving.value) return null;
    saving.value = true;
    try {
      const card = await api.updateLocalAgent(
        session.value.token,
        session.value.userId,
        agentId,
        input,
      );
      await refresh();
      await reloadCatalog();
      showToast(t("agentsLocalSaved"), "success");
      return card;
    } catch (caught) {
      showToast(messageOf(caught), "error");
      return null;
    } finally {
      saving.value = false;
    }
  }

  function openChat(agent: AgentCard): void {
    select(agent);
    void router.push({ name: "conversation" });
  }

  function openEdit(agentId: string): void {
    void router.push({ name: "agents-local-edit", params: { agentId } });
  }

  function openLocalList(): void {
    void router.push({ name: "agents-local" });
  }

  async function openDirectory(agentId: string): Promise<void> {
    if (!session.value || busyAgentId.value) return;
    busyAgentId.value = agentId;
    try {
      const directory = await api.visitDirectory(session.value.token, agentId, session.value.userId);
      if (!window.agentUp?.openVisitDirectory) {
        showToast(t("agentsLocalNeedDesktop"), "error");
        return;
      }
      await window.agentUp.openVisitDirectory(directory);
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      busyAgentId.value = "";
    }
  }

  async function publish(agent: AgentCard): Promise<void> {
    if (!session.value || busyAgentId.value) return;
    await runWithAccount("agent.publish", async () => {
      const current = session.value;
      if (!current || isGuestSession(current) || busyAgentId.value) return;
      busyAgentId.value = agent.agentId;
      try {
        const directory = await api.visitDirectory(current.token, agent.agentId, current.userId);
        await api.inspectAgent(current.token, directory);
        const published = await api.publish(
          current.token,
          directory,
          agent.name,
          agent.role,
          agent.background,
          agent.publishedAgentId,
          agent.rules ?? "",
        );
        await api.bindLocalPublishedAgent(
          current.token,
          current.userId,
          agent.agentId,
          published.agentId,
        );
        await refresh();
        await reloadCatalog();
        showToast(
          agent.publishedAgentId
            ? tf("agentsLocalRepublished", { id: published.agentId })
            : tf("agentsLocalPublished", { id: published.agentId }),
          "success",
        );
      } catch (caught) {
        showToast(messageOf(caught), "error");
      } finally {
        busyAgentId.value = "";
      }
    });
  }

  async function remove(agentId: string): Promise<void> {
    if (!session.value || busyAgentId.value) return;
    busyAgentId.value = agentId;
    try {
      await api.deleteLocalAgent(session.value.token, session.value.userId, agentId);
      await refresh();
      await reloadCatalog();
      showToast(t("agentsLocalDeleted"), "success");
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      busyAgentId.value = "";
    }
  }

  return {
    busyAgentId,
    creating,
    saving,
    create,
    load,
    update,
    openChat,
    openEdit,
    openLocalList,
    openDirectory,
    publish,
    remove,
  };
}

function messageOf(caught: unknown): string {
  return caught instanceof DesktopApiError ? caught.message : t("agentsLocalRequestFailed");
}
