import { computed, type Ref } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import { showToast } from "../../../shared/model/toast";
import { injectThreadAgentId } from "../model/thread/thread-agent-id";
import { injectThreadExtras } from "../model/thread/thread-extras";

/** 将 cwd 相对路径用系统默认应用打开（Electron shell.openPath）。 */
export function useOpenWorkspaceFile(options?: { api?: DesktopApi; agentId?: Ref<string> }) {
  const api = options?.api ?? new DesktopApi();
  const { session } = useDesktop();
  const injectedAgentId = injectThreadAgentId();
  const extras = injectThreadExtras();
  const agentId = computed(() => options?.agentId?.value || injectedAgentId);
  const personal = computed(() => extras.value.personal);

  async function openWorkspaceFile(relativePath: string): Promise<void> {
    const path = relativePath.replace(/^@/, "").trim();
    if (!path) return;
    if (!window.agentUp?.openPath) {
      showToast("请在 AgentUp 桌面应用中打开", "error");
      return;
    }
    const token = session.value?.token ?? "";
    const userId = session.value?.userId ?? "";
    if (!token || !userId || !agentId.value) {
      showToast("未登录或会话无效", "error");
      return;
    }
    try {
      const absolute = await api.resolveWorkspaceAbsolute(
        token,
        userId,
        agentId.value,
        personal.value,
        path,
      );
      await window.agentUp.openPath(absolute);
    } catch (caught) {
      if (caught instanceof DesktopApiError) {
        showToast(caught.message, "error");
        return;
      }
      showToast(caught instanceof Error && caught.message ? caught.message : "无法打开文件", "error");
    }
  }

  return { openWorkspaceFile };
}
