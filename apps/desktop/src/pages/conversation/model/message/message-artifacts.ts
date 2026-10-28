/** 与 runtime `agentUpArtifacts` 对齐：本回合 ARTIFACT/ 差分。 */

import type { UIMessage } from "ai";

export type ArtifactChangeKind = "added" | "modified" | "deleted";

export type ArtifactChange = {
  path: string;
  kind: ArtifactChangeKind;
  size?: number;
};

export type AgentUpArtifacts = {
  files: ArtifactChange[];
  truncated?: boolean;
};

/** deliver_artifacts / complete_group_task 确认后的路径清单（可含 WORK/）。 */
export type ConfirmedArtifactPath = {
  path: string;
  size?: number;
};

/** 产物卡片分页大小。 */
export const ARTIFACT_PAGE_SIZE = 5;

/** 从 UIMessage.metadata 读出本回合产物清单。 */
export function readAgentUpArtifacts(metadata: unknown): AgentUpArtifacts | null {
  if (!metadata || typeof metadata !== "object") return null;
  const custom = (metadata as { custom?: unknown }).custom;
  const raw =
    custom && typeof custom === "object"
      ? (custom as { agentUpArtifacts?: unknown }).agentUpArtifacts
      : (metadata as { agentUpArtifacts?: unknown }).agentUpArtifacts;
  return parseAgentUpArtifacts(raw);
}

export function parseAgentUpArtifacts(raw: unknown): AgentUpArtifacts | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { files?: unknown }).files;
  if (!Array.isArray(list)) return null;
  const files: ArtifactChange[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as { path?: unknown; kind?: unknown; size?: unknown };
    if (typeof record.path !== "string" || !record.path.startsWith("ARTIFACT/")) continue;
    if (record.kind !== "added" && record.kind !== "modified" && record.kind !== "deleted") {
      continue;
    }
    const entry: ArtifactChange = { path: record.path, kind: record.kind };
    if (typeof record.size === "number" && Number.isFinite(record.size) && record.size >= 0) {
      entry.size = record.size;
    }
    files.push(entry);
  }
  if (files.length === 0) return null;
  const truncated = (raw as { truncated?: unknown }).truncated === true;
  return truncated ? { files, truncated: true } : { files };
}

/**
 * 把任务确认清单投影成面板用的 agentUpArtifacts。
 * 只保留 ARTIFACT/：WORK/ 是过程草稿，不进产物 tab。
 * 新确认源（群 complete_group_task、单聊 deliver_artifacts、以后别的）都接到这里。
 */
export function confirmedArtifactsPanel(
  confirmed: readonly ConfirmedArtifactPath[] | null | undefined,
): AgentUpArtifacts | null {
  if (!confirmed || confirmed.length === 0) return null;
  const files: ArtifactChange[] = [];
  for (const item of confirmed) {
    if (!item || typeof item.path !== "string" || !item.path.startsWith("ARTIFACT/")) continue;
    const entry: ArtifactChange = { path: item.path, kind: "added" };
    if (typeof item.size === "number" && Number.isFinite(item.size) && item.size >= 0) {
      entry.size = item.size;
    }
    files.push(entry);
  }
  return files.length > 0 ? { files } : null;
}

/**
 * 旁路 history / SSE 收口后：把确认产物挂到最近一条 assistant，
 * 让气泡 tab 与 ArtifactsPanel 继续只读 metadata.custom.agentUpArtifacts。
 * 已有差分（artifactPanel）时不覆盖。
 */
export function attachConfirmedArtifactsToMessages(
  messages: readonly UIMessage[],
  confirmed: readonly ConfirmedArtifactPath[] | null | undefined,
): UIMessage[] {
  const panel = confirmedArtifactsPanel(confirmed);
  if (!panel) return [...messages];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    if (readAgentUpArtifacts(message.metadata)) return [...messages];

    const prevMeta =
      message.metadata && typeof message.metadata === "object"
        ? (message.metadata as Record<string, unknown>)
        : {};
    const prevCustom =
      prevMeta.custom && typeof prevMeta.custom === "object"
        ? (prevMeta.custom as Record<string, unknown>)
        : {};
    const next = [...messages];
    next[index] = {
      ...message,
      metadata: {
        ...prevMeta,
        custom: {
          ...prevCustom,
          agentUpArtifacts: panel,
        },
      },
    };
    return next;
  }
  return [...messages];
}

/** 群任务产物在共享工作区；一对一仍在专员 cwd。 */
export function delegationWorkspaceAgentId(input: {
  groupId?: string | null;
  toAgentId?: string | null;
  fallback?: string;
}): string {
  const groupId = input.groupId?.trim();
  if (groupId) return `group:${groupId}`;
  return input.toAgentId?.trim() || input.fallback?.trim() || "delegation";
}

/** Tab 角标：1–9 原样，超过写 9+；0 为空。 */
export function formatArtifactCountBadge(count: number): string {
  if (count <= 0) return "";
  if (count > 9) return "9+";
  return String(count);
}

/** 文件名（不含目录）。 */
export function artifactFileName(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index === -1 ? filePath : filePath.slice(index + 1);
}

/** ARTIFACT/ 下的相对展示路径。 */
export function artifactDisplayPath(filePath: string): string {
  return filePath.startsWith("ARTIFACT/") ? filePath.slice("ARTIFACT/".length) : filePath;
}

/** 取前 `visible` 条；`hasMore` 表示还有未展示。 */
export function paginateArtifacts(
  files: readonly ArtifactChange[],
  visible: number,
): { items: ArtifactChange[]; hasMore: boolean } {
  const limit = Math.max(0, visible);
  return {
    items: files.slice(0, limit),
    hasMore: files.length > limit,
  };
}
