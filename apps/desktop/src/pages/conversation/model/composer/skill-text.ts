/**
 * Composer / 历史中的 skill 引用：行业通行的 `/skill-name`（兼认 Pi `/skill:name`）。
 * 发送时由 runtime harness 展开为 `<skill>` 块注入上下文（agentskills.io）。
 * 文件引用 `@ATTACHMENTS/...` 与 skill 共用段模型，便于同一 contenteditable 渲染。
 */

import { findAttachmentRefs } from "./attachment-ref";
import { findMentionRefs } from "./mention-text";

const SKILL_NAME = "[a-z0-9]+(?:-[a-z0-9]+)*";
/** 完整引用：前界 + /name|/skill:name + 后界（空白/标点/行尾）。插入时默认补空格。 */
const SKILL_REF_RE = new RegExp(
  `(^|[\\s([{（【])\\/(?:skill:)?(${SKILL_NAME})(?=$|[\\s,.;:!?，。；：！？)\\]}）】])`,
  "gi",
);

export type ComposerSegment =
  | { type: "text"; value: string }
  | { type: "skill"; name: string }
  | { type: "mention"; name: string }
  | { type: "file"; path: string; name: string; folder?: boolean };

/** 光标处正在输入的 `/` 查询（尚未变成完整引用）。 */
export function slashQueryAtCursor(
  text: string,
  cursor: number,
): { query: string; start: number; end: number } | null {
  const before = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
  const match = before.match(new RegExp(`(^|[\\s([{（【])\\/(?:skill:)?([a-z0-9-]*)$`, "i"));
  if (!match) return null;
  const token = match[0].slice(match[1].length);
  const start = before.length - token.length;
  return { query: (match[2] ?? "").toLowerCase(), start, end: cursor };
}

/** 整段仅是 `/` 查询时。 */
export function slashSkillQuery(text: string): string | null {
  const match = text.match(new RegExp(`^\\/(?:skill:)?([a-z0-9-]*)$`, "i"));
  return match ? match[1].toLowerCase() : null;
}

/**
 * 插入 `/name`，替换 [start,end) 上的 slash 查询。
 * 默认带前后空格（行首不加前空格；后空格始终补，便于继续输入参数）。
 */
export function insertSkillReference(
  text: string,
  start: number,
  end: number,
  name: string,
): { text: string; cursor: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trail = /^\s/.test(after) ? "" : " ";
  const token = `/${name}`;
  const inserted = `${lead}${token}${trail}`;
  return { text: before + inserted + after, cursor: before.length + inserted.length };
}

/**
 * 将正文拆成 text / skill / mention / file 段（用于内联芯片）。
 * `knownNames` 有值时只高亮集合内 skill 名称；省略则高亮任意合法 `/skill-name` 形态（历史气泡）。
 * `knownMentions` 有值时把完整 `@成员名` 收成 mention 芯片（须带空格/标点边界）。
 */
export function segmentComposerText(
  text: string,
  knownNames?: ReadonlySet<string>,
  knownMentions?: ReadonlySet<string>,
): ComposerSegment[] {
  if (!text) return [];
  type Hit =
    | { kind: "skill"; start: number; end: number; name: string }
    | { kind: "mention"; start: number; end: number; name: string }
    | { kind: "file"; start: number; end: number; path: string; name: string; folder: boolean };
  const hits: Hit[] = [];
  const re = new RegExp(SKILL_REF_RE.source, "gi");
  for (const match of text.matchAll(re)) {
    const boundary = match[1] ?? "";
    const name = (match[2] ?? "").toLowerCase();
    if (knownNames && !knownNames.has(name)) continue;
    const index = match.index ?? 0;
    const start = index + boundary.length;
    const end = start + match[0].length - boundary.length;
    hits.push({ kind: "skill", start, end, name });
  }
  for (const file of findAttachmentRefs(text)) {
    hits.push({
      kind: "file",
      start: file.start,
      end: file.end,
      path: file.path,
      name: file.name,
      folder: file.folder,
    });
  }
  for (const mention of findMentionRefs(text, knownMentions ?? new Set())) {
    hits.push({
      kind: "mention",
      start: mention.start,
      end: mention.end,
      name: mention.name,
    });
  }
  hits.sort((a, b) => a.start - b.start || a.end - b.end);
  // 重叠时优先先出现的；跳过与已占用区间相交的后续 hit
  const kept: Hit[] = [];
  let occupied = 0;
  for (const hit of hits) {
    if (hit.start < occupied) continue;
    kept.push(hit);
    occupied = hit.end;
  }
  if (!kept.length) return [{ type: "text", value: text }];
  const segments: ComposerSegment[] = [];
  let last = 0;
  for (const hit of kept) {
    if (hit.start > last) segments.push({ type: "text", value: text.slice(last, hit.start) });
    if (hit.kind === "skill") segments.push({ type: "skill", name: hit.name });
    else if (hit.kind === "mention") segments.push({ type: "mention", name: hit.name });
    else {
      segments.push({
        type: "file",
        path: hit.path,
        name: hit.name,
        folder: hit.folder || undefined,
      });
    }
    last = hit.end;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return mergeTextSegments(segments);
}

/**
 * 历史/用户气泡：前置 `<skill>` 块 + 正文内 `/name`，拆成内联段（与 Composer 芯片同形）。
 */
export function segmentDisplayMessage(text: string): ComposerSegment[] {
  const leading = splitLeadingSkillBlocks(text);
  const segments: ComposerSegment[] = [];
  for (const name of leading.skills) {
    const trimmed = name.trim();
    if (trimmed) segments.push({ type: "skill", name: trimmed.toLowerCase() });
  }
  const body = leading.body;
  if (!body) return mergeTextSegments(segments);
  if (segments.length && !/^\s/.test(body)) {
    segments.push({ type: "text", value: " " });
  }
  segments.push(...segmentComposerText(body));
  return mergeTextSegments(segments);
}

export type DisplayFileRef = { path: string; name: string };

/**
 * 历史气泡：文件引用抽到附件条，正文只留 skill + 文字，避免芯片与正文缠在一起。
 */
export function partitionDisplayAttachments(segments: readonly ComposerSegment[]): {
  files: DisplayFileRef[];
  body: ComposerSegment[];
} {
  const files: DisplayFileRef[] = [];
  const rawBody: ComposerSegment[] = [];
  for (const segment of segments) {
    if (segment.type === "file") {
      files.push({ path: segment.path, name: segment.name });
      continue;
    }
    rawBody.push(segment);
  }
  return { files, body: tidyDisplayBody(rawBody) };
}

/** 去掉抽出文件后留下的多余空白。 */
function tidyDisplayBody(segments: readonly ComposerSegment[]): ComposerSegment[] {
  const merged = mergeTextSegments(
    segments.map((segment) =>
      segment.type === "text"
        ? { type: "text" as const, value: segment.value.replace(/[ \t\u00a0]+/g, " ") }
        : segment,
    ),
  );
  if (!merged.length) return [];
  const first = merged[0];
  if (first?.type === "text") first.value = first.value.replace(/^\s+/, "");
  const last = merged[merged.length - 1];
  if (last?.type === "text") last.value = last.value.replace(/\s+$/, "");
  return merged.filter(
    (segment) =>
      segment.type === "skill" ||
      segment.type === "mention" ||
      segment.type === "file" ||
      segment.value.length > 0,
  );
}

function mergeTextSegments(segments: ComposerSegment[]): ComposerSegment[] {
  const out: ComposerSegment[] = [];
  for (const segment of segments) {
    const prev = out[out.length - 1];
    if (segment.type === "text" && prev?.type === "text") {
      prev.value += segment.value;
    } else {
      out.push(segment.type === "text" ? { ...segment } : segment);
    }
  }
  return out.filter(
    (segment) =>
      segment.type === "skill" ||
      segment.type === "mention" ||
      segment.type === "file" ||
      segment.value.length > 0,
  );
}

function chipToken(segment: Exclude<ComposerSegment, { type: "text" }>): string {
  if (segment.type === "skill") return `/${segment.name}`;
  if (segment.type === "mention") return `@${segment.name}`;
  return `@${segment.path}`;
}

/** 段序列化回 `/name`、`@成员` 与 `@ATTACHMENTS/...`；标记两侧补空格，保证可用空格边界识别。 */
export function serializeComposerSegments(segments: ComposerSegment[]): string {
  let out = "";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (segment.type === "text") {
      out += segment.value;
      continue;
    }
    if (out.length > 0 && !/\s$/.test(out)) out += " ";
    out += chipToken(segment);
    const next = segments[index + 1];
    if (!next) {
      out += " ";
      continue;
    }
    if (next.type === "skill" || next.type === "mention" || next.type === "file") {
      out += " ";
      continue;
    }
    if (next.value.length > 0 && !/^\s/.test(next.value)) out += " ";
  }
  return out;
}

export function splitLeadingSkillBlocks(text: string): { skills: string[]; body: string } {
  const skills: string[] = [];
  let rest = text;
  const blockRe =
    /^<skill name="([^"]+)" location="[^"]+">\n[\s\S]*?\n<\/skill>(?:\n\n|\n)?/;
  while (true) {
    const match = rest.match(blockRe);
    if (!match) break;
    skills.push(match[1]);
    rest = rest.slice(match[0].length);
  }
  return { skills, body: rest };
}

/** 历史气泡展示：前置 `<skill>` 块 + 正文内 `/name`。 */
export function displaySkillMessage(text: string): { skills: string[]; body: string } {
  const leading = splitLeadingSkillBlocks(text);
  const names = [...leading.skills];
  const re = new RegExp(SKILL_REF_RE.source, "gi");
  for (const match of leading.body.matchAll(re)) {
    const name = (match[2] ?? "").toLowerCase();
    if (!names.includes(name)) names.push(name);
  }
  let body = leading.body;
  if (names.length) {
    body = leading.body
      .replace(re, (full, boundary: string, name: string) => {
        if (names.includes(name.toLowerCase())) return boundary ?? "";
        return full;
      })
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ \n/g, "\n")
      .trim();
  }
  return { skills: names, body };
}

export function filterSkillsByQuery<T extends { name: string; description: string }>(
  skills: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q),
  );
}

/** 生成独立 skill 引用文本（工具栏插入等）；无参数时仍带尾空格以便继续输入。 */
export function skillCommandText(name: string, args = ""): string {
  const trimmed = args.trim();
  return trimmed ? `/${name} ${trimmed}` : `/${name} `;
}
