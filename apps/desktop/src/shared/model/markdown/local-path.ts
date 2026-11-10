/**
 * 从 Markdown 原文启发式抽取「像本地路径」的片段（不做 FS 存在性校验）。
 * 供流结束后链化；点击时再走 preview / 系统打开。
 */

const MAX_CANDIDATES = 32;

/** 边界：空白或常见中英文标点（不含路径字符 / \ : .）；中文逗号/括号前后都要能断开 */
const BOUNDARY_BEFORE = "(^|[\\s,，([{（【「『\"'<>])";
const BOUNDARY_AFTER = "(?=$|[\\s,.;:!?，。；：！？)\\]}）（【】」』\"'<>])";

/** 路径体：排除空白、括号引号，避免吃掉 Markdown `]` `)` */
const PATH_BODY = "[^\\s<>\"'`\\[\\]()（）]+";

/** file:///绝对 或 file://相对（两斜杠、无 host；首段勿当 URL host） */
const FILE_URL_ABS_RE = new RegExp(
  `${BOUNDARY_BEFORE}(file:\\/\\/\\/${PATH_BODY})${BOUNDARY_AFTER}`,
  "gi",
);
const FILE_URL_REL_RE = new RegExp(
  `${BOUNDARY_BEFORE}(file:\\/\\/(?!\\/)(${PATH_BODY}))${BOUNDARY_AFTER}`,
  "gi",
);

/** Windows 盘符或 UNC */
const WIN_ABS_RE = new RegExp(
  `${BOUNDARY_BEFORE}(([A-Za-z]:[\\\\/]${PATH_BODY}|\\\\\\\\${PATH_BODY}))${BOUNDARY_AFTER}`,
  "g",
);

/** POSIX 绝对：/ 后至少一段 */
const POSIX_ABS_RE = new RegExp(
  `${BOUNDARY_BEFORE}(/${PATH_BODY}/${PATH_BODY})${BOUNDARY_AFTER}`,
  "g",
);

/** 相对：./ ../ 或 含 / 且 basename 带扩展名 */
const REL_DOT_RE = new RegExp(
  `${BOUNDARY_BEFORE}(\\.{1,2}/${PATH_BODY})${BOUNDARY_AFTER}`,
  "g",
);

const REL_EXT_RE = new RegExp(
  `${BOUNDARY_BEFORE}((?:[A-Za-z0-9._-]+/)+[A-Za-z0-9._-]+\\.[A-Za-z0-9]{1,12})${BOUNDARY_AFTER}`,
  "g",
);

const INLINE_CODE_RE = /`([^`\n]+)`/g;
const MD_LINK_HREF_RE = /\[[^\]]*]\(([^)\s]+)\)/g;
const FENCE_RE = /^```[\s\S]*?^```/gm;

const URLISH_RE = /^(https?:|mailto:|www\.)/i;
const VERSION_RE = /^\d+(?:\.\d+){1,3}$/;
const AND_OR_RE = /^and\/or$/i;

export type NormalizedLocalPath =
  | { kind: "relative"; path: string }
  | { kind: "absolute"; path: string };

/** 去掉围栏代码块，避免把示例路径链化。 */
function stripFencedCode(source: string): string {
  return source.replace(FENCE_RE, "\n");
}

function pushUnique(out: string[], seen: Set<string>, raw: string): void {
  const trimmed = raw.trim();
  if (!trimmed || seen.has(trimmed) || out.length >= MAX_CANDIDATES) return;
  if (URLISH_RE.test(trimmed) || AND_OR_RE.test(trimmed) || VERSION_RE.test(trimmed)) return;
  seen.add(trimmed);
  out.push(trimmed);
}

type IndexedHit = { start: number; raw: string };

function collectFromRegex(text: string, re: RegExp, group: number, hits: IndexedHit[]): void {
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const hit = match[group];
    if (!hit) continue;
    hits.push({ start: match.index + (match[1]?.length ?? 0), raw: hit });
  }
}

function looksLikePathToken(token: string): boolean {
  const t = token.trim();
  if (!t || URLISH_RE.test(t) || AND_OR_RE.test(t) || VERSION_RE.test(t)) return false;
  // 只要带真实路径体的 file://；裸 `file://` / `file:///` 是协议名，不是可开路径
  if (/^file:\/\//i.test(t)) {
    return /^file:\/\/\/.+/i.test(t) || /^file:\/\/[^/].+/i.test(t);
  }
  if (/^[A-Za-z]:[\\/]/.test(t) || t.startsWith("\\\\")) return true;
  if (t.startsWith("/") && t.includes("/", 1)) return true;
  if (t.startsWith("./") || t.startsWith("../")) return true;
  if ((t.includes("/") || t.includes("\\")) && /\.[A-Za-z0-9]{1,12}$/.test(t)) return true;
  return false;
}

/** chip 可见文案：basename；全路径留给 title / data-local-path。 */
export function localPathChipLabel(target: NormalizedLocalPath, raw?: string): string {
  const normalized = target.path.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = normalized.split("/").filter(Boolean).pop() ?? "";
  if (base) return base;
  const fallback = (raw ?? "").trim();
  return fallback || target.path;
}

/** 从 Markdown 原文抽出候选路径字符串（按出现顺序去重，最多 32）。 */
export function extractLocalPathCandidates(source: string): string[] {
  if (!source) return [];
  const text = stripFencedCode(source);
  const hits: IndexedHit[] = [];

  collectFromRegex(text, FILE_URL_ABS_RE, 2, hits);
  collectFromRegex(text, FILE_URL_REL_RE, 2, hits);
  collectFromRegex(text, WIN_ABS_RE, 2, hits);
  collectFromRegex(text, POSIX_ABS_RE, 2, hits);
  collectFromRegex(text, REL_DOT_RE, 2, hits);
  collectFromRegex(text, REL_EXT_RE, 2, hits);

  INLINE_CODE_RE.lastIndex = 0;
  let codeMatch: RegExpExecArray | null;
  while ((codeMatch = INLINE_CODE_RE.exec(text))) {
    const inner = codeMatch[1]?.trim() ?? "";
    if (looksLikePathToken(inner)) hits.push({ start: codeMatch.index, raw: inner });
  }

  MD_LINK_HREF_RE.lastIndex = 0;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = MD_LINK_HREF_RE.exec(text))) {
    const href = linkMatch[1]?.trim() ?? "";
    if (looksLikePathToken(href)) hits.push({ start: linkMatch.index, raw: href });
  }

  hits.sort((a, b) => a.start - b.start || b.raw.length - a.raw.length);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    pushUnique(out, seen, hit.raw);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/**
 * 规范化候选。
 * file:///abs → absolute；file://rel/path（两斜杠）→ relative，勿把首段当 host 吞掉。
 */
export function normalizeLocalPathCandidate(raw: string): NormalizedLocalPath | null {
  let value = raw.trim();
  if (!value) return null;

  if (/^file:\/\//i.test(value)) {
    const rest = value.replace(/^file:\/\//i, "");
    // 裸 file:// / file:///
    if (!rest || rest === "/") return null;

    // file://相对：第二段不是空（没有第三道 /）
    if (!rest.startsWith("/")) {
      const relative = rest.replace(/\\/g, "/");
      if (!relative || relative === ".") return null;
      return { kind: "relative", path: relative };
    }

    try {
      const url = new URL(value);
      if (url.protocol !== "file:") return null;
      // file:///C:/x → /C:/x on posix URL parser; Windows 盘符单独处理
      let pathname = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
      // 裸 file:///：URL 规范常把 pathname 落成 "/"，勿当成磁盘根目录链
      if (!pathname || pathname === "/") return null;
      return { kind: "absolute", path: pathname };
    } catch {
      return null;
    }
  }

  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/")) {
    return { kind: "absolute", path: value };
  }

  // 相对：统一斜杠，去掉前导 ./
  let relative = value.replace(/\\/g, "/");
  while (relative.startsWith("./")) relative = relative.slice(2);
  if (!relative || relative.startsWith("../")) {
    // ../ 工作区 API 不接受；仍标为 relative 原文剥 ./ 后保留，点击时可能失败
    if (!relative) return null;
  }
  if (relative.startsWith("/")) return { kind: "absolute", path: relative };
  return { kind: "relative", path: relative };
}

/** 供渲染：原文候选 → 规范化后的打开目标；用于替换时按最长原文优先。 */
export function buildLocalPathLinkMap(
  source: string,
): Map<string, NormalizedLocalPath> {
  const map = new Map<string, NormalizedLocalPath>();
  for (const raw of extractLocalPathCandidates(source)) {
    const normalized = normalizeLocalPathCandidate(raw);
    if (!normalized) continue;
    map.set(raw, normalized);
  }
  return map;
}

/** markdown-it 本地路径伪协议，点击时解析，勿当外链打开。 */
export const LOCAL_PATH_HREF_PREFIX = "agentup-local:";

export function encodeLocalPathHref(target: NormalizedLocalPath): string {
  return `${LOCAL_PATH_HREF_PREFIX}${target.kind}:${encodeURIComponent(target.path)}`;
}

export function parseLocalPathHref(href: string): NormalizedLocalPath | null {
  if (!href.startsWith(LOCAL_PATH_HREF_PREFIX)) return null;
  const rest = href.slice(LOCAL_PATH_HREF_PREFIX.length);
  const colon = rest.indexOf(":");
  if (colon <= 0) return null;
  const kind = rest.slice(0, colon);
  if (kind !== "relative" && kind !== "absolute") return null;
  try {
    const path = decodeURIComponent(rest.slice(colon + 1));
    if (!path) return null;
    return { kind, path };
  } catch {
    return null;
  }
}

/**
 * 在围栏外把路径候选改成 MD 链接（伪协议 href），供 markdown-it 渲染。
 * 最长原文优先，避免短路径吞掉长路径；可见文案用 basename。
 */
export function injectLocalPathMarkdownLinks(source: string): string {
  if (!source) return "";
  const map = buildLocalPathLinkMap(source);
  if (map.size === 0) return source;

  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  const parts: string[] = [];
  let last = 0;
  const fenceRe = /```[\s\S]*?```/g;
  let fence: RegExpExecArray | null;
  while ((fence = fenceRe.exec(source))) {
    parts.push(injectInProse(source.slice(last, fence.index), keys, map));
    parts.push(fence[0]);
    last = fence.index + fence[0].length;
  }
  parts.push(injectInProse(source.slice(last), keys, map));
  return parts.join("");
}

function injectInProse(
  prose: string,
  keys: string[],
  map: Map<string, NormalizedLocalPath>,
): string {
  if (!prose || keys.length === 0) return prose;

  // 已是 MD 链接的 href：改写成伪协议，保留作者写的可见文案
  let text = prose.replace(MD_LINK_HREF_RE, (full, href: string) => {
    if (URLISH_RE.test(href) || !looksLikePathToken(href)) return full;
    const normalized = map.get(href) ?? normalizeLocalPathCandidate(href);
    if (!normalized) return full;
    const label = full.slice(0, full.lastIndexOf("("));
    return `${label}(${encodeLocalPathHref(normalized)})`;
  });

  // 行内 code 整段是路径 → 链化（basename 作可见文案）
  text = text.replace(INLINE_CODE_RE, (full, inner: string) => {
    const raw = inner.trim();
    const target = map.get(raw);
    if (!target) return full;
    return `[${localPathChipLabel(target, raw)}](${encodeLocalPathHref(target)})`;
  });

  // 占位已有链接，避免裸路径二次包进 `[...](...)`
  const held: string[] = [];
  text = text.replace(/\[[^\]]*]\([^)]*\)/g, (block) => {
    const key = `\0LP${held.length}\0`;
    held.push(block);
    return key;
  });

  for (const raw of keys) {
    const target = map.get(raw);
    if (!target) continue;
    const href = encodeLocalPathHref(target);
    const label = localPathChipLabel(target, raw);
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(^|[\\s,，([{（【「『\"'<>])(${escaped})(?=$|[\\s,.;:!?，。；：！？)\\]}）（【】」』\"'<>])`,
      "g",
    );
    text = text.replace(re, (_full, before: string) => `${before}[${label}](${href})`);
  }

  return text.replace(/\0LP(\d+)\0/g, (_m, i: string) => held[Number(i)] ?? "");
}
