import { computed, ref, type Ref } from "vue";

import { useDesktop } from "../../../app/desktop";
import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import { showToast } from "../../../shared/model/ui/toast";
import { t } from "../../../shared/model/ui/ui-locale";
import { injectChatSurface } from "../model/thread/chat-surface";
import { injectThreadAgentId } from "../model/thread/thread-agent-id";
import { injectThreadExtras } from "../model/thread/thread-extras";
import { resolveWorkspaceAgentId } from "../model/workspace/workspace-agent-id";
import {
  isHtmlWorkspacePath,
  isMarkdownWorkspacePath,
} from "../model/workspace/workspace-path";
import {
  workspacePackagePathCandidates,
  type WorkspacePackageRoot,
} from "../model/workspace/workspace-path-resolve";
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
  const surface = injectChatSurface();
  // 群聊 inject 为空：与 open/reveal 一样回落 group:<id>，否则 auth 会 toast「读取工作空间失败」
  const agentId = computed(() =>
    resolveWorkspaceAgentId({
      override: options?.agentId?.value,
      injectedAgentId,
      groupId: surface.value.groupId,
    }),
  );
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

  function isNotFound(caught: unknown): boolean {
    return (
      caught instanceof DesktopApiError &&
      (caught.status === 404 || /找不到文件/.test(caught.message))
    );
  }

  /** 列出 WORK/ARTIFACT 下一层交付目录，供包内相对路径回落。 */
  async function listPackageRoots(
    token: string,
    userId: string,
  ): Promise<WorkspacePackageRoot[]> {
    const roots: WorkspacePackageRoot[] = [];
    // ARTIFACT 优先：交付镜像通常更完整
    for (const root of ["ARTIFACT", "WORK"] as const) {
      try {
        const listed = await api.listWorkspace(
          token,
          userId,
          agentId.value,
          personal.value,
          root,
        );
        const children = listed.entries
          .filter((entry) => entry.kind === "dir")
          .map((entry) => entry.name);
        if (children.length > 0) roots.push({ root, children });
      } catch {
        // 根目录不存在时跳过
      }
    }
    return roots;
  }

  async function readRelativeWithFallback(
    token: string,
    userId: string,
    path: string,
  ): Promise<{ file: Awaited<ReturnType<DesktopApi["readWorkspaceFile"]>>; path: string }> {
    try {
      const file = await api.readWorkspaceFile(
        token,
        userId,
        agentId.value,
        personal.value,
        path,
      );
      return { file, path: file.path || path };
    } catch (caught) {
      if (!isNotFound(caught)) throw caught;
      const candidates = workspacePackagePathCandidates(path, await listPackageRoots(token, userId));
      for (const candidate of candidates) {
        try {
          const file = await api.readWorkspaceFile(
            token,
            userId,
            agentId.value,
            personal.value,
            candidate,
          );
          return { file, path: file.path || candidate };
        } catch (inner) {
          if (isNotFound(inner)) continue;
          throw inner;
        }
      }
      throw caught;
    }
  }

  async function previewWorkspaceFile(relativePath: string): Promise<void> {
    const path = relativePath.replace(/^@/, "").trim();
    if (!path || loading.value) return;

    const creds = auth();
    if (!creds) return;

    loading.value = true;
    try {
      // 消息里常写 css/style.css（包内相对）；根下没有则回落 WORK/ARTIFACT/from-…
      const { file, path: resolvedPath } = await readRelativeWithFallback(
        creds.token,
        creds.userId,
        path,
      );

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

      await openWorkspaceFile(resolvedPath);
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
