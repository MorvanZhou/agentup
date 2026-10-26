import { computed, ref, type Ref } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import { showToast } from "../../../shared/model/ui/toast";
import { t } from "../../../shared/model/ui/ui-locale";
import { injectThreadAgentId } from "../model/thread/thread-agent-id";
import { injectThreadExtras } from "../model/thread/thread-extras";
import {
  isHtmlWorkspacePath,
  isMarkdownWorkspacePath,
} from "../model/workspace/workspace-path";
import { useOpenWorkspaceFile } from "./useOpenWorkspaceFile";

/**
 * 工作区文件应用内预览：图片 / HTML / Markdown 走 shared preview；
 * 其余（含 binary、过大）回落到系统默认应用打开。
 */
export function usePreviewWorkspaceFile(options?: { api?: DesktopApi; agentId?: Ref<string> }) {
  const api = options?.api ?? new DesktopApi();
  const { session } = useDesktop();
  const injectedAgentId = injectThreadAgentId();
  const extras = injectThreadExtras();
  const agentId = computed(() => options?.agentId?.value || injectedAgentId);
  const personal = computed(() => extras.value.personal);
  const { openWorkspaceFile } = useOpenWorkspaceFile(options);

  const loading = ref(false);

  const imageOpen = ref(false);
  const imageSrc = ref("");
  const imagePath = ref("");

  const htmlOpen = ref(false);
  const htmlSource = ref("");
  const htmlPath = ref("");

  const markdownOpen = ref(false);
  const markdownSource = ref("");
  const markdownPath = ref("");

  function auth(): { token: string; userId: string } | null {
    const token = session.value?.token ?? "";
    const userId = session.value?.userId ?? "";
    if (!token || !userId || !agentId.value) {
      showToast(t("wsLoadFailed"), "error");
      return null;
    }
    return { token, userId };
  }

  async function previewWorkspaceFile(relativePath: string): Promise<void> {
    const path = relativePath.replace(/^@/, "").trim();
    if (!path || loading.value) return;

    const creds = auth();
    if (!creds) return;

    loading.value = true;
    try {
      const file = await api.readWorkspaceFile(
        creds.token,
        creds.userId,
        agentId.value,
        personal.value,
        path,
      );

      const resolvedPath = file.path || path;

      if (file.kind === "image") {
        imageSrc.value = `data:${file.mediaType};base64,${file.dataBase64}`;
        imagePath.value = resolvedPath;
        window.setTimeout(() => {
          imageOpen.value = true;
        }, 0);
        return;
      }

      if (file.kind === "text") {
        if (isHtmlWorkspacePath(resolvedPath)) {
          htmlSource.value = file.text;
          htmlPath.value = resolvedPath;
          window.setTimeout(() => {
            htmlOpen.value = true;
          }, 0);
          return;
        }
        if (isMarkdownWorkspacePath(resolvedPath)) {
          markdownSource.value = file.text;
          markdownPath.value = resolvedPath;
          window.setTimeout(() => {
            markdownOpen.value = true;
          }, 0);
          return;
        }
      }

      await openWorkspaceFile(path);
    } catch (caught) {
      if (caught instanceof DesktopApiError) {
        showToast(caught.message, "error");
        return;
      }
      showToast(caught instanceof Error && caught.message ? caught.message : t("wsLoadFailed"), "error");
    } finally {
      loading.value = false;
    }
  }

  return {
    loading,
    imageOpen,
    imageSrc,
    imagePath,
    htmlOpen,
    htmlSource,
    htmlPath,
    markdownOpen,
    markdownSource,
    markdownPath,
    previewWorkspaceFile,
  };
}
