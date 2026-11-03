import { computed, type Ref } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { WorkspaceScope } from "../../../shared/api/runtime/workspace";
import { showToast } from "../../../shared/model/ui/toast";
import { t } from "../../../shared/model/ui/ui-locale";
import { injectChatSurface } from "../model/thread/chat-surface";
import { injectThreadAgentId } from "../model/thread/thread-agent-id";
import { injectThreadExtras } from "../model/thread/thread-extras";
import { resolveWorkspaceAgentId } from "../model/workspace/workspace-agent-id";

/** 将 cwd / project 相对路径在系统文件管理器中显示。 */
export function useRevealWorkspaceFile(options?: { api?: DesktopApi; agentId?: Ref<string> }) {
  const api = options?.api ?? new DesktopApi();
  const { session } = useDesktop();
  const injectedAgentId = injectThreadAgentId();
  const extras = injectThreadExtras();
  const surface = injectChatSurface();
  // 群聊 inject 为空时回落 group:<id>（与 preview / open 对齐）
  const agentId = computed(() =>
    resolveWorkspaceAgentId({
      override: options?.agentId?.value,
      injectedAgentId,
      groupId: surface.value.groupId,
    }),
  );
  const personal = computed(() => extras.value.personal);

  async function revealWorkspaceFile(
    relativePath: string,
    workspaceScope?: WorkspaceScope,
  ): Promise<void> {
    const path = relativePath.replace(/^@/, "").trim();
    if (!path) return;
    if (!window.agentUp?.revealInFolder) {
      showToast(t("wsNeedDesktop"), "error");
      return;
    }
    const token = session.value?.token ?? "";
    const userId = session.value?.userId ?? "";
    if (!token || !userId || !agentId.value) {
      showToast(t("wsLoadFailed"), "error");
      return;
    }
    try {
      const absolute = await api.resolveWorkspaceAbsolute(
        token,
        userId,
        agentId.value,
        personal.value,
        path,
        workspaceScope,
      );
      await window.agentUp.revealInFolder(absolute);
    } catch (caught) {
      if (caught instanceof DesktopApiError) {
        showToast(caught.message, "error");
        return;
      }
      showToast(caught instanceof Error && caught.message ? caught.message : t("wsLoadFailed"), "error");
    }
  }

  return { revealWorkspaceFile };
}
