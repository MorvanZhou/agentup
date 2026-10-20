import { computed, ref, watch, type Ref } from "vue";

import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { WorkspaceEntry, WorkspaceFile } from "../../../shared/api/runtime/workspace";
import { showToast } from "../../../shared/model/toast";
import { joinWorkspacePath, parentWorkspacePath, workspaceBaseName } from "../model/workspace-path";
import {
  type WorkspaceTab,
  isUnderWorkspaceTab,
  workspaceTabLabel,
  workspaceTabRoot,
  workspaceTabTitle,
} from "../model/workspace-roots";

export function useWorkspace(options: {
  token: Ref<string>;
  userId: Ref<string>;
  agentId: Ref<string>;
  personal: Ref<boolean>;
  generation: Ref<number>;
  api?: DesktopApi;
}) {
  const api = options.api ?? new DesktopApi();
  const tab = ref<WorkspaceTab>("deliverables");
  const directory = ref(workspaceTabRoot("deliverables"));
  const entries = ref<WorkspaceEntry[]>([]);
  const loading = ref(false);
  const error = ref("");
  const previewPath = ref("");
  const file = ref<WorkspaceFile | null>(null);
  const draft = ref("");
  const saving = ref(false);
  const busy = ref(false);
  let ticket = 0;

  const tabRoot = computed(() => workspaceTabRoot(tab.value));
  const previewing = computed(() => previewPath.value !== "");
  const dirty = computed(() => file.value?.kind === "text" && draft.value !== file.value.text);
  const title = computed(() =>
    workspaceTabTitle(
      directory.value,
      tabRoot.value,
      workspaceTabLabel(tab.value),
      previewing.value ? workspaceBaseName(previewPath.value) : undefined,
    ),
  );
  const canGoUp = computed(
    () => previewing.value || (directory.value !== "" && directory.value !== tabRoot.value),
  );
  /** 附件 Tab 以浏览/管理上传为主，不提供新建。 */
  const canCreate = computed(() => tab.value === "deliverables" && !previewing.value);

  async function loadDirectory(next = directory.value): Promise<void> {
    const root = tabRoot.value;
    const target = isUnderWorkspaceTab(next, root) ? next : root;
    const current = ++ticket;
    loading.value = true;
    error.value = "";
    try {
      const result = await api.listWorkspace(
        options.token.value,
        options.userId.value,
        options.agentId.value,
        options.personal.value,
        target,
      );
      if (current !== ticket) return;
      directory.value = result.path || root;
      entries.value = result.entries;
    } catch (caught) {
      if (current !== ticket) return;
      entries.value = [];
      error.value = messageOf(caught);
    } finally {
      if (current === ticket) loading.value = false;
    }
  }

  function setTab(next: WorkspaceTab): void {
    if (tab.value === next) return;
    if (dirty.value) {
      showToast("还有未保存的修改");
      return;
    }
    tab.value = next;
    previewPath.value = "";
    file.value = null;
    draft.value = "";
    void loadDirectory(workspaceTabRoot(next));
  }

  async function openWithSystem(relativePath: string): Promise<void> {
    if (!window.agentUp?.openPath) {
      showToast("请在 AgentUp 桌面应用中打开");
      return;
    }
    try {
      const absolute = await api.resolveWorkspaceAbsolute(
        options.token.value,
        options.userId.value,
        options.agentId.value,
        options.personal.value,
        relativePath,
      );
      await window.agentUp.openPath(absolute);
    } catch (caught) {
      showToast(messageOf(caught));
    }
  }

  async function openFile(target: string): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      const result = await api.readWorkspaceFile(
        options.token.value,
        options.userId.value,
        options.agentId.value,
        options.personal.value,
        target,
      );
      // 应用内无法预览（二进制 / 过大）：交给系统默认应用
      if (result.kind === "binary" || result.kind === "too-large") {
        await openWithSystem(result.path || target);
        return;
      }
      previewPath.value = result.path;
      file.value = result;
      draft.value = result.kind === "text" ? result.text : "";
    } catch (caught) {
      showToast(messageOf(caught));
    } finally {
      loading.value = false;
    }
  }

  async function openEntry(entry: WorkspaceEntry): Promise<void> {
    const target = joinWorkspacePath(directory.value, entry.name);
    if (entry.kind === "dir") {
      await loadDirectory(target);
      return;
    }
    await openFile(target);
  }

  function back(): void {
    if (previewPath.value) {
      if (dirty.value) {
        showToast("还有未保存的修改");
        return;
      }
      previewPath.value = "";
      file.value = null;
      draft.value = "";
      void loadDirectory();
      return;
    }
    const parent = parentWorkspacePath(directory.value);
    const root = tabRoot.value;
    if (!isUnderWorkspaceTab(parent, root) && parent !== root) {
      void loadDirectory(root);
      return;
    }
    void loadDirectory(parent || root);
  }

  function refresh(): void {
    if (previewPath.value) {
      if (!dirty.value) void openFile(previewPath.value);
      return;
    }
    void loadDirectory();
  }

  async function save(): Promise<void> {
    if (!dirty.value || saving.value || !previewPath.value) return;
    saving.value = true;
    try {
      await api.writeWorkspaceText(
        options.token.value,
        options.userId.value,
        options.agentId.value,
        options.personal.value,
        previewPath.value,
        draft.value,
      );
      file.value = {
        path: previewPath.value,
        kind: "text",
        size: new TextEncoder().encode(draft.value).length,
        text: draft.value,
      };
    } catch (caught) {
      showToast(messageOf(caught));
    } finally {
      saving.value = false;
    }
  }

  async function create(kind: "file" | "dir", name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed || busy.value || !canCreate.value) return false;
    busy.value = true;
    try {
      const target = joinWorkspacePath(directory.value, trimmed);
      await api.createWorkspaceEntry(
        options.token.value,
        options.userId.value,
        options.agentId.value,
        options.personal.value,
        target,
        kind,
      );
      await loadDirectory(directory.value);
      if (kind === "file") await openFile(target);
      return true;
    } catch (caught) {
      showToast(messageOf(caught));
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function rename(entry: WorkspaceEntry, name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed || busy.value) return false;
    busy.value = true;
    try {
      const target = joinWorkspacePath(directory.value, entry.name);
      const next = await api.renameWorkspaceEntry(
        options.token.value,
        options.userId.value,
        options.agentId.value,
        options.personal.value,
        target,
        trimmed,
      );
      if (previewPath.value === target) previewPath.value = next;
      await loadDirectory();
      return true;
    } catch (caught) {
      showToast(messageOf(caught));
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function remove(target: string): Promise<boolean> {
    return removeMany([target]);
  }

  async function removeMany(targets: string[]): Promise<boolean> {
    const paths = [...new Set(targets.map((item) => item.trim()).filter(Boolean))];
    if (!paths.length || busy.value) return false;
    busy.value = true;
    try {
      for (const target of paths) {
        await api.deleteWorkspaceEntry(
          options.token.value,
          options.userId.value,
          options.agentId.value,
          options.personal.value,
          target,
        );
        if (previewPath.value === target) {
          previewPath.value = "";
          file.value = null;
          draft.value = "";
        }
      }
      await loadDirectory();
      return true;
    } catch (caught) {
      showToast(messageOf(caught));
      await loadDirectory();
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function reveal(entry: WorkspaceEntry): Promise<void> {
    if (!window.agentUp?.revealInFolder) {
      showToast("请在 AgentUp 桌面应用中打开");
      return;
    }
    try {
      const target = joinWorkspacePath(directory.value, entry.name);
      const absolute = await api.resolveWorkspaceAbsolute(
        options.token.value,
        options.userId.value,
        options.agentId.value,
        options.personal.value,
        target,
      );
      await window.agentUp.revealInFolder(absolute);
    } catch (caught) {
      showToast(messageOf(caught));
    }
  }

  watch(
    [options.agentId, options.userId, options.token],
    () => {
      previewPath.value = "";
      file.value = null;
      draft.value = "";
      tab.value = "deliverables";
      directory.value = workspaceTabRoot("deliverables");
      void loadDirectory(workspaceTabRoot("deliverables"));
    },
    { immediate: true },
  );

  watch(options.generation, () => {
    refresh();
  });

  return {
    tab,
    setTab,
    directory,
    entries,
    loading,
    error,
    previewPath,
    file,
    draft,
    saving,
    busy,
    previewing,
    dirty,
    title,
    canGoUp,
    canCreate,
    loadDirectory,
    openEntry,
    back,
    refresh,
    save,
    create,
    rename,
    remove,
    removeMany,
    reveal,
  };
}

function messageOf(caught: unknown): string {
  if (caught instanceof DesktopApiError) return caught.message;
  return caught instanceof Error && caught.message ? caught.message : "读取工作空间失败";
}
