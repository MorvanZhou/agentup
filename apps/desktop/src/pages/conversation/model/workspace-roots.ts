import { t } from "../../../shared/model/ui-locale";

/** 与 runtime `cwd-layout` 对齐的工作空间 Tab 根目录。 */
export const ARTIFACT_DIR = "ARTIFACT";
export const ATTACHMENTS_DIR = "ATTACHMENTS";

export type WorkspaceTab = "artifact" | "attachments";

export const WORKSPACE_TABS: ReadonlyArray<{
  id: WorkspaceTab;
  root: string;
}> = [
  { id: "artifact", root: ARTIFACT_DIR },
  { id: "attachments", root: ATTACHMENTS_DIR },
];

export function workspaceTabRoot(tab: WorkspaceTab): string {
  return tab === "attachments" ? ATTACHMENTS_DIR : ARTIFACT_DIR;
}

export function workspaceTabLabel(tab: WorkspaceTab): string {
  return tab === "attachments" ? t("wsAttachments") : t("wsArtifact");
}

/** 目录是否仍落在当前 Tab 根下（含根本身）。 */
export function isUnderWorkspaceTab(directory: string, tabRoot: string): boolean {
  return directory === tabRoot || directory.startsWith(`${tabRoot}/`);
}

/** 顶栏标题：在 Tab 根显示本地化标签，子路径显示相对路径。 */
export function workspaceTabTitle(
  directory: string,
  tabRoot: string,
  tabLabel: string,
  previewName?: string,
): string {
  if (previewName) return previewName;
  if (!directory || directory === tabRoot) return tabLabel;
  if (directory.startsWith(`${tabRoot}/`)) return directory.slice(tabRoot.length + 1);
  return directory;
}
