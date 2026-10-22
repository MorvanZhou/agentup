/** 与 runtime `agentUpArtifacts` 对齐：本回合 ARTIFACT/ 差分。 */

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
