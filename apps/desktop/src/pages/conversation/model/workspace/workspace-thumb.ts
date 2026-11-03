import type { WorkspaceEntry } from "../../../../shared/api/runtime/workspace";
import { isWorkspaceImagePath } from "../../../../shared/workspace-media";

/** 图标视图自动拉缩略图的体积上限；更大的仍显示通用文件图标。 */
export const WORKSPACE_THUMB_MAX_BYTES = 2 * 1024 * 1024;

export type WorkspaceThumbPayload = {
  mediaType: string;
  dataBase64: string;
};

export type WorkspaceThumbLoader = (relativePath: string) => Promise<WorkspaceThumbPayload | null>;

export function shouldLoadWorkspaceThumb(entry: WorkspaceEntry): boolean {
  return (
    entry.kind === "file" &&
    isWorkspaceImagePath(entry.name) &&
    entry.size > 0 &&
    entry.size <= WORKSPACE_THUMB_MAX_BYTES
  );
}

export function workspaceThumbDataUrl(payload: WorkspaceThumbPayload): string {
  return `data:${payload.mediaType};base64,${payload.dataBase64}`;
}
