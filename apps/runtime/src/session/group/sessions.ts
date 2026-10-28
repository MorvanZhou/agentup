import fs from "node:fs";

import type { GroupLine } from "./types.js";

export type GroupSessionRecord = {
  id: string;
  lines: GroupLine[];
};

/** 每条群消息一行。尾部换行，便于从文件末尾往前翻页。 */
export function formatSessionJsonl(lines: readonly GroupLine[]): string {
  if (lines.length === 0) return "";
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

export function parseSessionJsonl(text: string): GroupLine[] {
  const lines: GroupLine[] = [];
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    lines.push(JSON.parse(trimmed) as GroupLine);
  }
  return lines;
}

/**
 * 从文件尾部往前读。`onLine` 返回 true 时停下，不再解析更早的行。
 * chunkBytes 仅用于测试跨块边界。
 */
function scanJsonlNewestFirst(
  filePath: string,
  onLine: (line: GroupLine) => boolean,
  chunkBytes: number,
): void {
  if (!fs.existsSync(filePath)) return;
  const stat = fs.statSync(filePath);
  if (stat.size === 0) return;
  const fd = fs.openSync(filePath, "r");
  try {
    let position = stat.size;
    let pending = Buffer.alloc(0);
    let stop = false;
    const emit = (raw: string): void => {
      if (stop) return;
      const text = raw.trim();
      if (!text) return;
      if (onLine(JSON.parse(text) as GroupLine)) stop = true;
    };
    while (position > 0 && !stop) {
      const size = Math.min(chunkBytes, position);
      position -= size;
      const chunk = Buffer.alloc(size);
      fs.readSync(fd, chunk, 0, size, position);
      const data = Buffer.concat([chunk, pending]);
      let end = data.length;
      const complete: Buffer[] = [];
      for (let index = data.length - 1; index >= 0; index -= 1) {
        if (data[index] !== 0x0a) continue;
        const slice = data.subarray(index + 1, end);
        if (slice.length > 0) complete.push(slice);
        end = index;
      }
      pending = data.subarray(0, end);
      for (const part of complete) {
        if (stop) break;
        emit(part.toString("utf8"));
      }
    }
    if (!stop && pending.length > 0) emit(pending.toString("utf8"));
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 从 jsonl 文件尾部读取最近 count 条，结果仍按时间从旧到新。
 * 按换行切块，不把整个文件解析成一个 JSON 数组。chunkBytes 仅用于测试跨块边界。
 */
export function readJsonlFileTail(filePath: string, count: number, chunkBytes = 64 * 1024): GroupLine[] {
  if (count <= 0) return [];
  const newestFirst: GroupLine[] = [];
  scanJsonlNewestFirst(
    filePath,
    (line) => {
      newestFirst.push(line);
      return newestFirst.length >= count;
    },
    chunkBytes,
  );
  return newestFirst.reverse();
}

export type GroupPageSource = {
  id: string;
  /** jsonl 文件。与 lines 二选一；翻页时只解析需要的尾部。 */
  path?: string;
  /** 旧版整份 JSON。 */
  lines?: readonly GroupLine[];
};

export function contextResetLine(sessionId: string, at = 0): GroupLine {
  return {
    id: `context-reset-${sessionId}`,
    at,
    role: "system",
    authorId: "system",
    text: "已开始新对话，之后不再带入此前上下文",
    mentionIds: [],
  };
}

/**
 * 从最新一条 session 往旧翻。`beforeId` 是界面已经有的最旧一条。
 * 结果从旧到新，并在跨 session 时补上新对话标记。
 */
export function readGroupLinesPage(
  sessions: readonly GroupPageSource[],
  options: { limit: number; beforeId?: string },
  chunkBytes = 64 * 1024,
): { lines: GroupLine[]; hasMore: boolean } {
  const limit = options.limit;
  if (limit <= 0) return { lines: [], hasMore: false };
  const wanted = limit + 1;
  const newestFirst: GroupLine[] = [];
  let seen = options.beforeId == null;

  const consider = (line: GroupLine): boolean => {
    if (!seen) {
      if (line.id === options.beforeId) seen = true;
      return false;
    }
    newestFirst.push(line);
    return newestFirst.length >= wanted;
  };

  for (let index = sessions.length - 1; index >= 0 && newestFirst.length < wanted; index -= 1) {
    const session = sessions[index]!;
    let oldestAt = 0;
    let saw = false;
    const take = (line: GroupLine): boolean => {
      oldestAt = line.at;
      saw = true;
      return consider(line);
    };
    if (session.path) {
      scanJsonlNewestFirst(session.path, take, chunkBytes);
    } else {
      const lines = session.lines ?? [];
      for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
        if (take(lines[lineIndex]!)) break;
      }
    }
    if (newestFirst.length >= wanted) break;
    if (index > 0 && consider(contextResetLine(session.id, saw ? oldestAt : 0))) break;
  }

  if (options.beforeId && !seen) return { lines: [], hasMore: false };
  return {
    lines: newestFirst.slice(0, limit).reverse(),
    hasMore: newestFirst.length > limit,
  };
}

/** 按「新对话」标记把可见记录切成多段。标记本身不写入某一段。 */
export function splitSessionLines(lines: readonly GroupLine[]): GroupLine[][] {
  const segments: GroupLine[][] = [[]];
  for (const line of lines) {
    if (line.id.startsWith("context-reset-")) {
      segments.push([]);
      continue;
    }
    segments[segments.length - 1]?.push(line);
  }
  return segments;
}

/** 按 session 顺序拼回界面记录。除第一段外，每段前面插入一条新对话标记。 */
export function stitchSessionLines(sessions: readonly GroupSessionRecord[]): GroupLine[] {
  const lines: GroupLine[] = [];
  sessions.forEach((session, index) => {
    if (index > 0) {
      lines.push(contextResetLine(session.id, session.lines[0]?.at ?? 0));
    }
    lines.push(...session.lines);
  });
  return lines;
}
