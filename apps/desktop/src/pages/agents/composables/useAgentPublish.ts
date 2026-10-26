import { ref, watch, type Ref } from "vue";

import { runWithAccount } from "../../../app/auth-gate";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import {
  agentEditorCapabilityChanged,
  agentEditorProfileChanged,
  type AgentEditorInitial,
  type AgentEditorInput,
} from "../../../shared/model/agent-editor/agent-editor";
import type { PackageIssue, PublishedAgent, Session } from "../../../shared/model/runtime/runtime";
import { isGuestSession } from "../../../shared/model/session/session";
import { showToast } from "../../../shared/model/ui/toast";
import { t, tf } from "../../../shared/model/ui/ui-locale";

/**
 * 市场发布 / 更新：
 * - 名片层（name/role/background/rules/avatar）→ PUT /card，不升版
 * - 能力层（skills/MCP）→ publish-editor 临时组包升版（不创建 loc-*）
 * - 打开更新 → publish-editor/preview（不 hydrate 本机草稿）
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
  const initial = ref<AgentEditorInitial | null>(null);
  const published = ref<PublishedAgent | null>(null);
  const errorDetails = ref<PackageIssue[]>([]);

  watch(
    [() => session.value?.token, () => session.value?.userId, agentId],
    ([token, userId, id]) => {
      updateAgentId.value = id ?? "";
      initial.value = null;
      published.value = null;
      errorDetails.value = [];
      if (token && userId && id) void loadTarget(token, id);
      else if (!id) {
        initial.value = { name: "", role: "", background: "" };
      }
    },
    { immediate: true },
  );

  async function loadTarget(token: string, id: string): Promise<void> {
    loading.value = true;
    try {
      const preview = await api.previewPublishEditor(token, id);
      initial.value = {
        name: preview.name,
        role: preview.role,
        background: preview.background,
        rules: preview.rules,
        skills: preview.skills,
        mcpServers: preview.mcpServers,
        avatarUrl: preview.avatarUrl,
      };
    } catch (caught) {
      showToast(messageOf(caught), "error");
      errorDetails.value = detailsOf(caught);
    } finally {
      loading.value = false;
    }
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
          published.value = await api.publishFromEditor(current.token, {
            name: input.name,
            role: input.role,
            background: input.background,
            rules: input.rules ?? "",
            skillPaths: input.skillPaths,
            mcpServers: input.mcpServers,
            avatarDataUrl: input.avatarDataUrl,
          });
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
              userId: current.userId,
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
            published.value = await api.publishFromEditor(current.token, {
              name: input.name,
              role: input.role,
              background: input.background,
              rules: input.rules ?? "",
              agentId: updateAgentId.value,
              skillPaths: input.skillPaths,
              removeSkills: input.removeSkills,
              mcpServers: input.mcpServers,
              avatarDataUrl: input.avatarDataUrl,
            });
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
