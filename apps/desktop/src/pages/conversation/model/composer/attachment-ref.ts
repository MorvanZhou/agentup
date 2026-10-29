/**
 * Composer / 历史中的文件 / 文件夹引用。
 * 新：`@ATTACHMENTS/<name>_<id>.<ext>`（id 后缀，扩展名保持尾部）
 * 目录：`@ATTACHMENTS/<name>_<id>/`（尾 `/` 标记，供 FileChip 显示文件夹图标）
 * 旧扁平：`@ATTACHMENTS/<id>-<name>`（历史消息兼容）
 * 旧嵌套：`@ATTACHMENTS/<id>/<name>`（兼容历史消息）
 * 文件名在 staging 时已去除空白（空格→`_`），保证 token 不被空格截断。
 */

const ATTACHMENT_ID = "[A-Za-z0-9._-]+";
/** 文件名：无空白、无 @、无 / */
const ATTACHMENT_FILE = "[^\\s@/]+";
/** 扁平：ATTACHMENTS/<file> 或 ATTACHMENTS/<dir>/；旧嵌套：ATTACHMENTS/<id>/<file> */
const ATTACHMENT_REF_RE = new RegExp(
  `(^|[\\s([{（【])@(ATTACHMENTS\\/(?:${ATTACHMENT_ID}\\/)?${ATTACHMENT_FILE}\\/?)(?=$|[\\s,.;:!?，。；：！？)\\]}）】])`,
  "g",
);

export type AttachmentRefHit = {
  start: number;
  end: number;
  /** ATTACHMENTS/...，无前导 @；目录带尾 `/` */
  path: string;
  name: string;
  /** 目录引用（path 以 `/` 结尾）。 */
  folder: boolean;
};

export function attachmentRefToken(path: string): string {
  const relative = path.replace(/^@/, "").trim();
  return `@${relative}`;
}

/**
 * 展示用文件名：新格式剥 `<id>` 尾缀（保扩展名）；旧嵌套取 basename。
 * 旧扁平 `<id>-<name>` 不再剥前缀（显示原样，含 id）。
 */
export function attachmentFileName(path: string): string {
  // 目录 path 带尾 `/`，剥掉再取 basename
  const relative = path.replace(/^@/, "").replace(/\/+$/, "");
  const slash = relative.lastIndexOf("/");
  const base = slash >= 0 ? relative.slice(slash + 1) : relative;
  // 新格式：贪婪剥「最后一个」`_<id>` 段（紧跟扩展名之前），名字自带的日期段不受影响
  const modern = /^(.+)_[a-f0-9]{8}(\.[^./]+)?$/i.exec(base);
  if (modern?.[1]) return `${modern[1]}${modern[2] ?? ""}`;
  return base;
}

/** 目录芯片：staging / 工作区引用约定 path 以 `/` 结尾。 */
export function isAttachmentFolderPath(path: string): boolean {
  return path.replace(/^@/, "").trim().endsWith("/");
}

/** 统一目录引用形态：保证尾 `/`，供插入与展示。 */
export function attachmentFolderPath(path: string): string {
  const relative = path.replace(/^@/, "").trim().replace(/\/+$/, "");
  return relative ? `${relative}/` : relative;
}

/**
 * 长文件名中间省略，尽量保留扩展名。
 * `very_long_quarterly_report.docx` → `very_long…report.docx`
 */
export function middleEllipsisFileName(name: string, maxChars = 28): string {
  if (name.length <= maxChars) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  const stem = ext ? name.slice(0, -ext.length) : name;
  const ellipsis = "…";
  const budget = maxChars - ext.length - ellipsis.length;
  if (budget < 4) {
    return `${name.slice(0, Math.max(1, maxChars - 1))}${ellipsis}`;
  }
  const head = Math.ceil(budget * 0.55);
  const tail = Math.max(1, budget - head);
  return `${stem.slice(0, head)}${ellipsis}${stem.slice(-tail)}${ext}`;
}

/** 找出正文中全部合法 `@ATTACHMENTS/...` 引用。 */
export function findAttachmentRefs(text: string): AttachmentRefHit[] {
  if (!text) return [];
  const hits: AttachmentRefHit[] = [];
  const re = new RegExp(ATTACHMENT_REF_RE.source, "g");
  for (const match of text.matchAll(re)) {
    const boundary = match[1] ?? "";
    const path = match[2] ?? "";
    if (!path) continue;
    const index = match.index ?? 0;
    const start = index + boundary.length;
    const end = start + match[0].length - boundary.length;
    hits.push({
      start,
      end,
      path,
      name: attachmentFileName(path),
      folder: isAttachmentFolderPath(path),
    });
  }
  return hits;
}

/** 在 [start,end) 插入 `@ATTACHMENTS/...`，默认补两侧空格（与 skill 一致）。 */
export function insertAttachmentReference(
  text: string,
  start: number,
  end: number,
  pathOrRef: string,
): { text: string; cursor: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trail = /^\s/.test(after) ? "" : " ";
  const token = attachmentRefToken(pathOrRef);
  const inserted = `${lead}${token}${trail}`;
  return { text: before + inserted + after, cursor: before.length + inserted.length };
}

/** 正文中仍引用的 ATTACHMENTS 路径集合（无 @）。 */
export function attachmentPathsInText(text: string): Set<string> {
  return new Set(findAttachmentRefs(text).map((hit) => hit.path));
}
