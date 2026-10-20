import { ref, watch, type Ref } from "vue";

import { runWithAccount } from "../../../app/auth-gate";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { AgentSourcePreview, PackageIssue, PublishedAgent, Session } from "../../../shared/model/runtime";
import { isGuestSession } from "../../../shared/model/session";
import { showToast } from "../../../shared/model/toast";
import { t } from "../../../shared/model/ui-locale";

export function useAgentPublish(
  session: Ref<Session | null>,
  refresh: () => Promise<void>,
  agentId: Ref<string> = ref(""),
  api = new DesktopApi(),
) {
  const publishing = ref(false);
  const selectedDirectory = ref("");
  const name = ref("");
  const role = ref("");
  const summary = ref("");
  const updateAgentId = ref("");
  const preview = ref<AgentSourcePreview | null>(null);
  const published = ref<PublishedAgent | null>(null);
  const errorDetails = ref<PackageIssue[]>([]);

  watch(
    [() => session.value?.token, agentId],
    ([token, id]) => {
      updateAgentId.value = id ?? "";
      if (token && id) void loadTarget(token, id);
      else if (!id) {
        name.value = "";
        role.value = "";
        summary.value = "";
      }
    },
    { immediate: true },
  );

  async function loadTarget(token: string, id: string): Promise<void> {
    try {
      const owned = await api.ownedAgents(token);
      const agent = owned.find((item) => item.agentId === id);
      if (agent) {
        name.value = agent.name;
        role.value = agent.role;
        summary.value = agent.summary;
      } else {
        showToast("找不到要更新的 Agent");
      }
    } catch (caught) {
      showToast(messageOf(caught));
      errorDetails.value = detailsOf(caught);
    }
  }

  async function chooseDirectory(): Promise<void> {
    errorDetails.value = [];
    published.value = null;
    await runWithAccount("agent.publish", async () => {
      if (isGuestSession(session.value)) return;
      if (!window.agentUp) {
        showToast("请在 AgentUp 桌面应用中上传 Agent 运行包");
        return;
      }
      const directory = await window.agentUp.selectAgentDirectory();
      if (!directory || !session.value) return;
      selectedDirectory.value = directory;
      preview.value = null;
      try {
        preview.value = await api.inspectAgent(session.value.token, directory);
      } catch (caught) {
        showToast(messageOf(caught));
        errorDetails.value = detailsOf(caught);
      }
    });
  }

  async function publish(): Promise<void> {
    if (!session.value || !preview.value || publishing.value) return;
    await runWithAccount("agent.publish", async () => {
      const current = session.value;
      if (!current || isGuestSession(current) || !preview.value || publishing.value) return;
      if (!name.value.trim() || !role.value.trim() || !summary.value.trim()) {
        showToast(t("publishNeedMore"));
        return;
      }
      publishing.value = true;
      errorDetails.value = [];
      published.value = null;
      try {
        published.value = await api.publish(
          current.token,
          selectedDirectory.value,
          name.value.trim(),
          role.value.trim(),
          summary.value.trim(),
          updateAgentId.value || undefined,
        );
        await refresh();
      } catch (caught) {
        showToast(messageOf(caught));
        errorDetails.value = detailsOf(caught);
      } finally {
        publishing.value = false;
      }
    });
  }

  return {
    publishing,
    selectedDirectory,
    name,
    role,
    summary,
    updateAgentId,
    preview,
    published,
    errorDetails,
    chooseDirectory,
    publish,
  };
}

function messageOf(caught: unknown): string {
  return caught instanceof DesktopApiError ? caught.message : "发布失败";
}

function detailsOf(caught: unknown): PackageIssue[] {
  return caught instanceof DesktopApiError ? caught.details : [];
}
