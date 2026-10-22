import { computed, ref, watch, type Ref } from "vue";

import { DesktopApi, DesktopApiError } from "../../../shared/api/runtime";
import type { WorkspaceEntry, WorkspaceFile, WorkspaceScope } from "../../../shared/api/runtime/workspace";
import { showToast } from "../../../shared/model/toast";
import { t } from "../../../shared/model/ui-locale";
import { joinWorkspacePath, parentWorkspacePath, workspaceBaseName } from "../model/workspace/workspace-path";
import {
  type WorkspaceTab,
  isUnderWorkspaceTab,
  projectRootLabel,
  workspaceTabLabel,
  workspaceTabRoot,
  workspaceTabTitle,
} from "../model/workspace/workspace-roots";

export function useWorkspace(options: {
  token: Ref<string>;
  userId: Ref<string>;
  agentId: Ref<string>;
  personal: Ref<boolean>;
  generation: Ref<number>;
  api?: DesktopApi;
}) {
  const api = options.api ?? new DesktopApi();
  const tab = ref<WorkspaceTab>("artifact");
  const directory = ref(workspaceTabRoot("artifact"));
  const entries = ref<WorkspaceEntry[]>([]);
  const loading = ref(false);
  const error = ref("");
  const previewPath = ref("");
  const file = ref<WorkspaceFile | null>(null);
  const draft = ref("");
  const saving = ref(false);
  const busy = ref(false);
  /** 项目 Tab：当前进入的挂载根绝对路径；空串表示挂载列表。 */
  const activeProjectRoot = ref("");
  /** basename → 绝对路径（挂载列表用） */
  const projectRootByName = ref<Record<string, string>>({});
  let ticket = 0;

  const tabRoot = computed(() => workspaceTabRoot(tab.value));
  const atProjectList = computed(() => tab.value === "projects" && !activeProjectRoot.value);
  const workspaceScope = computed<WorkspaceScope | undefined>(() =>
    tab.value === "projects" && activeProjectRoot.value
      ? { scope: "project", root: activeProjectRoot.value }
      : undefined,
  );
  const previewing = computed(() => previewPath.value !== "");
  const dirty = computed(() => file.value?.kind === "text" && draft.value !== file.value.text);
  const title = computed(() => {
    if (tab.value === "projects") {
      if (previewing.value) return workspaceBaseName(previewPath.value);
      if (activeProjectRoot.value) {
        if (!directory.value) return projectRootLabel(activeProjectRoot.value);
        return directory.value;
      }
      return workspaceTabLabel("projects");
    }
    return workspaceTabTitle(
      directory.value,
      tabRoot.value,
      workspaceTabLabel(tab.value),
      previewing.value ? workspaceBaseName(previewPath.value) : undefined,
    );
  });
  const canGoUp = computed(() => {
    if (tab.value === "projects") {
      return previewing.value || Boolean(activeProjectRoot.value);
    }
    return previewing.value || (directory.value !== "" && directory.value !== tabRoot.value);
  });
  /** 附件 / 项目列表不提供新建文件；项目内与产物可新建。 */
  const canCreate = computed(
    () =>
      !previewing.value &&
      (tab.value === "artifact" || (tab.value === "projects" && Boolean(activeProjectRoot.value))),
  );
  const canAddProject = computed(() => atProjectList.value && !previewing.value);

  async function loadProjectList(): Promise<void> {
    const current = ++ticket;
    loading.value = true;
    error.value = "";
    try {
      const roots = await api.listProjectRoots(
        options.token.value,
        options.userId.value,
        options.agentId.value,
        options.personal.value,
      );
      if (current !== ticket) return;
      const byName: Record<string, string> = {};
      const nextEntries: WorkspaceEntry[] = [];
      for (const root of roots) {
        let name = projectRootLabel(root);
        if (byName[name]) {
          name = `${name} (${root})`;
        }
        byName[name] = root;
        nextEntries.push({ name, kind: "dir", size: 0 });
      }
      projectRootByName.value = byName;
      directory.value = "";
      entries.value = nextEntries;
    } catch (caught) {
      if (current !== ticket) return;
      entries.value = [];
      projectRootByName.value = {};
      error.value = messageOf(caught);
    } finally {
      if (current === ticket) loading.value = false;
    }
  }

  async function loadDirectory(next = directory.value): Promise<void> {
    if (tab.value === "projects" && !activeProjectRoot.value) {
      await loadProjectList();
      return;
    }
    const root = tab.value === "projects" ? "" : tabRoot.value;
    const target =
      tab.value === "projects"
        ? next
        : isUnderWorkspaceTab(next, root)
          ? next
          : root;
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
        workspaceScope.value,
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
      showToast(t("wsUnsavedChanges"), "error");
      return;
    }
    tab.value = next;
    previewPath.value = "";
    file.value = null;
    draft.value = "";
    activeProjectRoot.value = "";
    projectRootByName.value = {};
    void loadDirectory(workspaceTabRoot(next));
  }

  async function openWithSystem(relativePath: string): Promise<void> {
    if (!window.agentUp?.openPath) {
      showToast(t("wsNeedDesktop"), "error");
      return;
    }
    try {
      const absolute = await api.resolveWorkspaceAbsolute(
        options.token.value,
        options.userId.value,
        options.agentId.value,
        options.personal.value,
        relativePath,
        workspaceScope.value,
      );
      await window.agentUp.openPath(absolute);
    } catch (caught) {
      showToast(messageOf(caught), "error");
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
        workspaceScope.value,
      );
      if (result.kind === "binary" || result.kind === "too-large") {
        await openWithSystem(result.path || target);
        return;
      }
      previewPath.value = result.path;
      file.value = result;
      draft.value = result.kind === "text" ? result.text : "";
    } catch (caught) {
      showToast(messageOf(caught), "error");
    } finally {
      loading.value = false;
    }
  }

  async function openEntry(entry: WorkspaceEntry): Promise<void> {
    if (atProjectList.value) {
      const absolute = projectRootByName.value[entry.name];
      if (!absolute) return;
      activeProjectRoot.value = absolute;
      directory.value = "";
      await loadDirectory("");
      return;
    }
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
        showToast(t("wsUnsavedChanges"), "error");
        return;
      }
      previewPath.value = "";
      file.value = null;
      draft.value = "";
      void loadDirectory();
      return;
    }
    if (tab.value === "projects") {
      if (directory.value) {
        const parent = parentWorkspacePath(directory.value);
        void loadDirectory(parent);
        return;
      }
      activeProjectRoot.value = "";
      void loadProjectList();
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
        workspaceScope.value,
      );
      file.value = {
        path: previewPath.value,
        kind: "text",
        size: new TextEncoder().encode(draft.value).length,
        text: draft.value,
      };
    } catch (caught) {
      showToast(messageOf(caught), "error");
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
        workspaceScope.value,
      );
      await loadDirectory(directory.value);
      if (kind === "file") await openFile(target);
      return true;
    } catch (caught) {
      showToast(messageOf(caught), "error");
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function rename(entry: WorkspaceEntry, name: string): Promise<boolean> {
    if (atProjectList.value) return false;
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
        workspaceScope.value,
      );
      if (previewPath.value === target) previewPath.value = next;
      await loadDirectory();
      return true;
    } catch (caught) {
      showToast(messageOf(caught), "error");
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
      if (atProjectList.value) {
        for (const nameOrPath of paths) {
          const absolute = projectRootByName.value[nameOrPath] ?? nameOrPath;
          await api.removeProjectRoot(
            options.token.value,
            options.userId.value,
            options.agentId.value,
            options.personal.value,
            absolute,
          );
        }
        await loadProjectList();
        return true;
      }
      for (const target of paths) {
        await api.deleteWorkspaceEntry(
          options.token.value,
          options.userId.value,
          options.agentId.value,
          options.personal.value,
          target,
          workspaceScope.value,
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
      showToast(messageOf(caught), "error");
      await loadDirectory();
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function addProject(): Promise<boolean> {
    if (!canAddProject.value || busy.value) return false;
    if (!window.agentUp?.selectDirectory) {
      showToast(t("wsNeedDesktop"), "error");
      return false;
    }
    busy.value = true;
    try {
      const selected = await window.agentUp.selectDirectory();
      if (!selected) return false;
      await api.addProjectRoot(
        options.token.value,
        options.userId.value,
        options.agentId.value,
        options.personal.value,
        selected,
      );
      await loadProjectList();
      return true;
    } catch (caught) {
      showToast(messageOf(caught), "error");
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function reveal(entry: WorkspaceEntry): Promise<void> {
    if (!window.agentUp?.revealInFolder) {
      showToast(t("wsNeedDesktop"), "error");
      return;
    }
    try {
      if (atProjectList.value) {
        const absolute = projectRootByName.value[entry.name];
        if (!absolute) return;
        await window.agentUp.revealInFolder(absolute);
        return;
      }
      const target = joinWorkspacePath(directory.value, entry.name);
      const absolute = await api.resolveWorkspaceAbsolute(
        options.token.value,
        options.userId.value,
        options.agentId.value,
        options.personal.value,
        target,
        workspaceScope.value,
      );
      await window.agentUp.revealInFolder(absolute);
    } catch (caught) {
      showToast(messageOf(caught), "error");
    }
  }

  watch(
    [options.agentId, options.userId, options.token],
    () => {
      previewPath.value = "";
      file.value = null;
      draft.value = "";
      activeProjectRoot.value = "";
      projectRootByName.value = {};
      tab.value = "artifact";
      directory.value = workspaceTabRoot("artifact");
      void loadDirectory(workspaceTabRoot("artifact"));
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
    canAddProject,
    atProjectList,
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
    addProject,
  };
}

function messageOf(caught: unknown): string {
  if (caught instanceof DesktopApiError) return caught.message;
  return caught instanceof Error && caught.message ? caught.message : t("wsLoadFailed");
}
