import type { WorkspaceEntry } from "../../../../shared/api/runtime/workspace";

export type WorkspaceSortBy = "name" | "updated" | "created";
export type WorkspaceViewMode = "list" | "icons";

const SORT_KEY = "agentup.workspace.sortBy";
const VIEW_KEY = "agentup.workspace.viewMode";

export function isWorkspaceSortBy(value: unknown): value is WorkspaceSortBy {
  return value === "name" || value === "updated" || value === "created";
}

export function isWorkspaceViewMode(value: unknown): value is WorkspaceViewMode {
  return value === "list" || value === "icons";
}

export function readWorkspaceSortBy(): WorkspaceSortBy {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    return isWorkspaceSortBy(raw) ? raw : "name";
  } catch {
    return "name";
  }
}

export function writeWorkspaceSortBy(sortBy: WorkspaceSortBy): void {
  try {
    localStorage.setItem(SORT_KEY, sortBy);
  } catch {
    /* 无存储时只保留本次内存选择 */
  }
}

export function readWorkspaceViewMode(): WorkspaceViewMode {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    return isWorkspaceViewMode(raw) ? raw : "list";
  } catch {
    return "list";
  }
}

export function writeWorkspaceViewMode(mode: WorkspaceViewMode): void {
  try {
    localStorage.setItem(VIEW_KEY, mode);
  } catch {
    /* 无存储时只保留本次内存选择 */
  }
}

/** 目录始终置顶；同 kind 内按选定字段排。 */
export function sortWorkspaceEntries(
  entries: readonly WorkspaceEntry[],
  sortBy: WorkspaceSortBy,
): WorkspaceEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
    if (sortBy === "updated") {
      const delta = (right.mtimeMs ?? 0) - (left.mtimeMs ?? 0);
      if (delta !== 0) return delta;
    } else if (sortBy === "created") {
      const delta = (right.birthtimeMs ?? 0) - (left.birthtimeMs ?? 0);
      if (delta !== 0) return delta;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}
