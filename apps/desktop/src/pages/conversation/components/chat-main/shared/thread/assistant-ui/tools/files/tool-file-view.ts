import { languageFromPath } from "../../../../../../../model/render/highlight-code";
import { argString } from "../shared/tool-args";

export { languageFromPath };

/** 单行 diff：删除 / 新增 / 上下文。 */
export type FileDiffLine = {
  kind: "add" | "remove" | "context";
  text: string;
};

export type EditHunk = {
  oldText: string;
  newText: string;
};

/** 从工具 args 取路径（兼容 path / file_path）。 */
export function filePathFromArgs(args: unknown): string {
  return argString(args, "path") || argString(args, "file_path");
}

/** 按行拆分；去掉末尾空行，避免 diff/代码块多出一行空白。 */
export function splitContentLines(text: string): string[] {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** 解析 edit 参数：优先 edits[]，兼容顶层 oldText/newText。 */
export function parseEditHunks(args: unknown): EditHunk[] {
  if (!args || typeof args !== "object") return [];
  const record = args as Record<string, unknown>;
  if (Array.isArray(record.edits)) {
    const hunks: EditHunk[] = [];
    for (const item of record.edits) {
      if (!item || typeof item !== "object") continue;
      const edit = item as Record<string, unknown>;
      if (typeof edit.oldText !== "string" || typeof edit.newText !== "string") continue;
      hunks.push({ oldText: edit.oldText, newText: edit.newText });
    }
    return hunks;
  }
  if (typeof record.oldText === "string" && typeof record.newText === "string") {
    return [{ oldText: record.oldText, newText: record.newText }];
  }
  return [];
}

/** 行级 LCS diff；过大时退化为整段删/增，避免 O(n²) 拖垮 UI。 */
export function diffLines(oldText: string, newText: string, maxLines = 400): FileDiffLine[] {
  const oldLines = splitContentLines(oldText);
  const newLines = splitContentLines(newText);
  if (oldLines.length === 0 && newLines.length === 0) return [];
  if (oldLines.length * newLines.length > maxLines * maxLines) {
    return [
      ...oldLines.map((text) => ({ kind: "remove" as const, text })),
      ...newLines.map((text) => ({ kind: "add" as const, text })),
    ];
  }
  const n = oldLines.length;
  const m = newLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] =
        oldLines[i] === newLines[j]
          ? (dp[i + 1]![j + 1] ?? 0) + 1
          : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
    }
  }
  const out: FileDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      out.push({ kind: "context", text: oldLines[i]! });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      out.push({ kind: "remove", text: oldLines[i]! });
      i += 1;
    } else {
      out.push({ kind: "add", text: newLines[j]! });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ kind: "remove", text: oldLines[i]! });
    i += 1;
  }
  while (j < m) {
    out.push({ kind: "add", text: newLines[j]! });
    j += 1;
  }
  return out;
}

/** 多个 edit hunk 各自成段，段间用空上下文分隔。 */
export function diffEditHunks(hunks: readonly EditHunk[]): FileDiffLine[] {
  const lines: FileDiffLine[] = [];
  hunks.forEach((hunk, index) => {
    if (index > 0) lines.push({ kind: "context", text: "…" });
    lines.push(...diffLines(hunk.oldText, hunk.newText));
  });
  return lines;
}

export function summarizeDiff(lines: readonly FileDiffLine[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") added += 1;
    else if (line.kind === "remove") removed += 1;
  }
  return { added, removed };
}

/** 摘要旁的 +N −M；全零时返回空。 */
export function formatDiffBadge(added: number, removed: number): string {
  if (added <= 0 && removed <= 0) return "";
  const parts: string[] = [];
  if (added > 0) parts.push(`+${added}`);
  if (removed > 0) parts.push(`−${removed}`);
  return parts.join(" ");
}

/** Read 的行号范围后缀：`:12-40` / `:12`。 */
export function formatReadRange(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  const offset = typeof record.offset === "number" ? record.offset : null;
  const limit = typeof record.limit === "number" ? record.limit : null;
  if (offset == null && limit == null) return "";
  const start = offset ?? 1;
  if (limit == null) return `:${start}`;
  return `:${start}-${start + limit - 1}`;
}
