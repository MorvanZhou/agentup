import { findAttachmentRefs } from "./attachment-ref";

export type ComposerMention = { id: string; name: string };

export type MentionRefHit = {
  start: number;
  end: number;
  name: string;
};

const MENTION_BOUNDARY_BEFORE = `(^|[\\s([{（【])`;
const MENTION_BOUNDARY_AFTER = `(?=$|[\\s,.;:!?，。；：！？)\\]}）】])`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MENTION_DONE_NEXT = /^[\s,.;:!?，。；：！？)\]\}）】]/;

/**
 * 光标处正在输入的 `@` 查询。
 * 若 `@token` 已是完整成员名，且光标落在其后的空格/标点/文末上，视为已选完，不再弹出选择器。
 * `@ATTACHMENTS/...` 是文件引用，不是成员；发送会 trim 掉尾部空格，编辑时光标常落在引用末尾。
 */
export function mentionQueryAtCursor(
  text: string,
  cursor: number,
  knownNames?: ReadonlySet<string>,
): { query: string; start: number; end: number } | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, safeCursor);
  const match = before.match(/(^|[\s([{（【])@([^\s@]*)$/);
  if (!match) return null;
  const query = match[2] ?? "";
  const token = match[0].slice(match[1]?.length ?? 0);
  const start = before.length - token.length;
  // 光标在文件引用内部（含贴在文末、没有尾随空格）时，不要当成成员查询。
  if (findAttachmentRefs(text).some((hit) => safeCursor > hit.start && safeCursor <= hit.end)) {
    return null;
  }
  if (knownNames?.has(query)) {
    const next = text.slice(safeCursor, safeCursor + 1);
    if (safeCursor >= text.length || MENTION_DONE_NEXT.test(next)) return null;
  }
  return { query, start, end: safeCursor };
}

/**
 * 插入 `@name`，替换 [start,end) 上的 @ 查询。
 * 默认带前后空格（与 skill / 附件芯片一致；行首不加前空格）。
 */
export function insertMention(
  text: string,
  start: number,
  end: number,
  member: ComposerMention,
): { text: string; cursor: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trail = /^\s/.test(after) ? "" : " ";
  const inserted = `${lead}@${member.name}${trail}`;
  return { text: before + inserted + after, cursor: before.length + inserted.length };
}

/**
 * 找出正文中完整的群成员 `@name`（须在 knownNames 内，且两侧有空格/标点边界）。
 * 长名优先，避免短名吞掉长名；与 `@ATTACHMENTS/...` 不冲突（附件另检）。
 */
export function findMentionRefs(
  text: string,
  knownNames: ReadonlySet<string>,
): MentionRefHit[] {
  if (!text || !knownNames.size) return [];
  const names = [...knownNames]
    .map((name) => name.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  const hits: MentionRefHit[] = [];
  const occupied: Array<{ start: number; end: number }> = [];
  for (const name of names) {
    const re = new RegExp(
      `${MENTION_BOUNDARY_BEFORE}@${escapeRegExp(name)}${MENTION_BOUNDARY_AFTER}`,
      "g",
    );
    for (const match of text.matchAll(re)) {
      const boundary = match[1] ?? "";
      const index = match.index ?? 0;
      const start = index + boundary.length;
      const end = start + match[0].length - boundary.length;
      if (occupied.some((span) => start < span.end && end > span.start)) continue;
      hits.push({ start, end, name });
      occupied.push({ start, end });
    }
  }
  return hits.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** 取正文里最靠前的群成员，用于选择其 Skill 与附件落盘目录。 */
export function firstMentionedMemberId(
  text: string,
  members: readonly ComposerMention[],
): string {
  for (const match of text.matchAll(/@([^\s@]+)/g)) {
    const token = match[1] ?? "";
    const member = members.find((item) => item.id === token || item.name === token);
    if (member) return member.id;
  }
  return "";
}
