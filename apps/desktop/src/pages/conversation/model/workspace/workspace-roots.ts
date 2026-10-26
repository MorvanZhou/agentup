import { t } from "../../../../shared/model/ui/ui-locale";

/** 与 runtime `cwd-layout` 对齐的工作空间 Tab 根目录。 */
export const ARTIFACT_DIR = "ARTIFACT";
export const ATTACHMENTS_DIR = "ATTACHMENTS";

export type WorkspaceTab = "artifact" | "attachments" | "projects";

export const WORKSPACE_TABS: ReadonlyArray<{
  id: WorkspaceTab;
  root: string;
}> = [
  { id: "artifact", root: ARTIFACT_DIR },
  { id: "attachments", root: ATTACHMENTS_DIR },
  { id: "projects", root: "" },
];

export function workspaceTabRoot(tab: WorkspaceTab): string {
  if (tab === "attachments") return ATTACHMENTS_DIR;
  if (tab === "projects") return "";
  return ARTIFACT_DIR;
}

export function workspaceTabLabel(tab: WorkspaceTab): string {
  if (tab === "attachments") return t("wsAttachments");
  if (tab === "projects") return t("wsProjects");
  return t("wsArtifact");
}

/** 目录是否仍落在当前 Tab 根下（含根本身）。 */
export function isUnderWorkspaceTab(directory: string, tabRoot: string): boolean {
  if (!tabRoot) return directory === "";
  return directory === tabRoot || directory.startsWith(`${tabRoot}/`);
}

/** 顶栏标题：在 Tab 根显示本地化标签，子路径显示相对路径。 */
export function workspaceTabTitle(
  directory: string,
  tabRoot: string,
  tabLabel: string,
  previewName?: string,
  projectLabel?: string,
): string {
  if (previewName) return previewName;
  if (projectLabel && (!directory || directory === "")) return projectLabel;
  if (!directory || directory === tabRoot) return tabLabel;
  if (tabRoot && directory.startsWith(`${tabRoot}/`)) return directory.slice(tabRoot.length + 1);
  return directory;
}

/** 取挂载根的展示名（末段目录名）。 */
export function projectRootLabel(absolutePath: string): string {
  const normalized = absolutePath.replace(/[/\\]+$/, "");
  const parts = normalized.split(/[/\\]/);
  return parts[parts.length - 1] || absolutePath;
}
