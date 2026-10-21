import { ref, watch, type Ref } from "vue";

import { runWithAccount } from "../../../app/auth-gate";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import {
  agentEditorCapabilityChanged,
  agentEditorProfileChanged,
  type AgentEditorInitial,
  type AgentEditorInput,
} from "../../../shared/model/agent-editor";
import type { PackageIssue, PublishedAgent, Session } from "../../../shared/model/runtime";
import { isGuestSession } from "../../../shared/model/session";
import { showToast } from "../../../shared/model/toast";
import { t, tf } from "../../../shared/model/ui-locale";

/**
 * 市场发布 / 更新：
 * - 名片层（name/role/background/rules/avatar）→ PUT /card，不升版
 * - 能力层（skills/MCP）→ 本机草稿 + 整包 publish 升版
 * - 打开更新且无草稿 → from-published hydrate
 */
export function useAgentPublish(
  session: Ref<Session | null>,
  refresh: () => Promise<void>,
  agentId: Ref<string> = ref(""),
  api = new DesktopApi(),
) {
  const publishing = ref(false);
  const loading = ref(false);
  const updateAgentId = ref("");
  const localDraftId = ref("");
  const initial = ref<AgentEditorInitial | null>(null);
  const published = ref<PublishedAgent | null>(null);
  const errorDetails = ref<PackageIssue[]>([]);

  watch(
    [() => session.value?.token, () => session.value?.userId, agentId],
    ([token, userId, id]) => {
      updateAgentId.value = id ?? "";
      localDraftId.value = "";
      initial.value = null;
      published.value = null;
      errorDetails.value = [];
      if (token && userId && id) void loadTarget(token, userId, id);
      else if (!id) {
        initial.value = { name: "", role: "", background: "" };
      }
    },
    { immediate: true },
  );

  async function loadTarget(token: string, userId: string, id: string): Promise<void> {
    loading.value = true;
    try {
      const [owned, locals] = await Promise.all([
        api.ownedAgents(token),
        api.localAgents(token, userId),
      ]);
      const agent = owned.find((item) => item.agentId === id);
      if (!agent) {
        showToast("找不到要更新的 Agent", "error");
        return;
      }
      let draft = locals.find((item) => item.publishedAgentId === id);
      if (!draft) {
        const hydrated = await api.importPublishedLocal(token, userId, id);
        draft = hydrated;
      }
      const detail = draft.agentId
        ? await api.getLocalAgent(token, userId, draft.agentId)
        : draft;
      localDraftId.value = detail.agentId;
      initial.value = {
        name: detail.name,
        role: detail.role,
        background: detail.background,
        rules: detail.rules ?? agent.rules,
        skills: detail.skills,
        mcpServers: detail.mcpServers,
        avatarUrl: detail.avatarUrl ?? agent.avatarUrl,
      };
    } catch (caught) {
      showToast(messageOf(caught), "error");
      errorDetails.value = detailsOf(caught);
    } finally {
      loading.value = false;
    }
  }

  async function publishFromLocal(
    current: Session,
    localAgentId: string,
    input: AgentEditorInput,
    publishedId?: string,
  ): Promise<PublishedAgent> {
    const directory = await api.visitDirectory(current.token, localAgentId, current.userId);
    await api.inspectAgent(current.token, directory);
    const result = await api.publish(
      current.token,
      directory,
      input.name,
      input.role,
      input.background,
      publishedId,
      input.rules ?? "",
    );
    await api.bindLocalPublishedAgent(current.token, current.userId, localAgentId, result.agentId);
    return result;
  }

  async function submit(input: AgentEditorInput): Promise<void> {
    if (!session.value || publishing.value) return;
    await runWithAccount("agent.publish", async () => {
      const current = session.value;
      if (!current || isGuestSession(current) || publishing.value) return;
      publishing.value = true;
      errorDetails.value = [];
      published.value = null;
      try {
        if (!updateAgentId.value) {
          const local = await api.createLocalAgent(current.token, current.userId, input);
          published.value = await publishFromLocal(current, local.agentId, input);
          showToast(tf("agentsLocalPublished", { id: published.value.agentId }), "success");
        } else {
          const profileDirty = agentEditorProfileChanged(input, initial.value);
          const capabilityDirty = agentEditorCapabilityChanged(input, initial.value);

          if (profileDirty) {
            const card = await api.updateAgentCard(current.token, updateAgentId.value, {
              name: input.name,
              role: input.role,
              background: input.background,
              rules: input.rules ?? "",
              avatarDataUrl: input.avatarDataUrl,
            });
            if (!capabilityDirty) {
              published.value = {
                agentId: card.agentId,
                name: card.name,
                role: card.role,
                background: card.background,
                version: card.latestVersion,
                digest: card.latestDigest,
              };
              showToast(t("publishCardUpdated"), "success");
            }
          }

          if (capabilityDirty) {
            if (!localDraftId.value) {
              const hydrated = await api.importPublishedLocal(
                current.token,
                current.userId,
                updateAgentId.value,
              );
              localDraftId.value = hydrated.agentId;
            }
            await api.updateLocalAgent(current.token, current.userId, localDraftId.value, {
              name: input.name,
              role: input.role,
              background: input.background,
              rules: input.rules,
              skillPaths: input.skillPaths,
              removeSkills: input.removeSkills,
              mcpServers: input.mcpServers,
              avatarDataUrl: input.avatarDataUrl,
            });
            published.value = await publishFromLocal(
              current,
              localDraftId.value,
              input,
              updateAgentId.value,
            );
            showToast(tf("agentsLocalRepublished", { id: published.value.agentId }), "success");
          }
        }
        await refresh();
      } catch (caught) {
        showToast(messageOf(caught), "error");
        errorDetails.value = detailsOf(caught);
      } finally {
        publishing.value = false;
      }
    });
  }

  return {
    publishing,
    loading,
    initial,
    localDraftId,
    published,
    errorDetails,
    submit,
  };
}

function messageOf(caught: unknown): string {
  return caught instanceof DesktopApiError ? caught.message : "发布失败";
}

function detailsOf(caught: unknown): PackageIssue[] {
  return caught instanceof DesktopApiError ? caught.details : [];
}
