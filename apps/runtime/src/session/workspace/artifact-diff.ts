import fs from "node:fs";
import path from "node:path";

import { ARTIFACT_DIR } from "./cwd-layout.js";

/** 单文件指纹：相对 cwd 的路径 + size + mtime。 */
export type ArtifactFileSnap = {
  path: string;
  size: number;
  mtimeMs: number;
};

export type ArtifactChangeKind = "added" | "modified" | "deleted";

/** 回合差分条目；path 相对 cwd（含 `ARTIFACT/` 前缀）。 */
export type ArtifactChange = {
  path: string;
  kind: ArtifactChangeKind;
  size?: number;
};

/** 写入会话 / 流式 metadata 的产物清单。 */
export type AgentUpArtifactsData = {
  files: ArtifactChange[];
  /** 扫描超过上限时截断。 */
  truncated?: boolean;
};

/** 单回合最多记录的变更数，避免 metadata 膨胀。 */
export const ARTIFACT_DIFF_LIMIT = 200;

/**
 * 递归快照 `ARTIFACT/` 下常规文件（跳过符号链接）。
 * 目录不存在时返回空 Map。
 */
export function snapshotArtifactDir(cwd: string): Map<string, ArtifactFileSnap> {
  const root = path.join(cwd, ARTIFACT_DIR);
  const out = new Map<string, ArtifactFileSnap>();
  walkFiles(root, ARTIFACT_DIR, out);
  return out;
}

/** 对比前后快照；顺序：新增 / 修改 / 删除，同组内按 path 排序。 */
export function diffArtifactSnapshots(
  before: ReadonlyMap<string, ArtifactFileSnap>,
  after: ReadonlyMap<string, ArtifactFileSnap>,
  limit = ARTIFACT_DIFF_LIMIT,
): AgentUpArtifactsData {
  const added: ArtifactChange[] = [];
  const modified: ArtifactChange[] = [];
  const deleted: ArtifactChange[] = [];

  for (const [filePath, snap] of after) {
    const prev = before.get(filePath);
    if (!prev) {
      added.push({ path: filePath, kind: "added", size: snap.size });
      continue;
    }
    if (prev.size !== snap.size || prev.mtimeMs !== snap.mtimeMs) {
      modified.push({ path: filePath, kind: "modified", size: snap.size });
    }
  }
  for (const filePath of before.keys()) {
    if (!after.has(filePath)) deleted.push({ path: filePath, kind: "deleted" });
  }

  const sortByPath = (left: ArtifactChange, right: ArtifactChange) =>
    left.path.localeCompare(right.path, "en");
  added.sort(sortByPath);
  modified.sort(sortByPath);
  deleted.sort(sortByPath);

  const merged = [...added, ...modified, ...deleted];
  if (merged.length <= limit) return { files: merged };
  return { files: merged.slice(0, limit), truncated: true };
}

export function parseArtifactsEntryData(data: unknown): AgentUpArtifactsData | undefined {
  if (!data || typeof data !== "object") return undefined;
  const raw = (data as { files?: unknown }).files;
  if (!Array.isArray(raw)) return undefined;
  const files: ArtifactChange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as { path?: unknown; kind?: unknown; size?: unknown };
    if (typeof record.path !== "string" || !record.path.startsWith(`${ARTIFACT_DIR}/`)) continue;
    if (record.kind !== "added" && record.kind !== "modified" && record.kind !== "deleted") {
      continue;
    }
    const entry: ArtifactChange = { path: record.path, kind: record.kind };
    if (typeof record.size === "number" && Number.isFinite(record.size) && record.size >= 0) {
      entry.size = record.size;
    }
    files.push(entry);
  }
  if (files.length === 0) return undefined;
  const truncated = (data as { truncated?: unknown }).truncated === true;
  return truncated ? { files, truncated: true } : { files };
}

function walkFiles(
  absolute: string,
  relative: string,
  out: Map<string, ArtifactFileSnap>,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absolute, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "." || entry.name === ".." || entry.name.includes("\0")) continue;
    const childAbs = path.join(absolute, entry.name);
    const childRel = relative ? `${relative}/${entry.name}` : entry.name;
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(childAbs);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      walkFiles(childAbs, childRel, out);
      continue;
    }
    if (!stat.isFile()) continue;
    out.set(childRel, { path: childRel, size: stat.size, mtimeMs: stat.mtimeMs });
  }
}
