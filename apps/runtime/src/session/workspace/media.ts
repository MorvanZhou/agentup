/**
 * 工作区「能不能在应用内打开」的唯一配置。
 * 体积、图片类型、文本 / HTML / Markdown 扩展名都写在这里。
 * runtime 直接引用；桌面经 `apps/desktop/src/shared/workspace-media.ts` 转出，不要再抄数字。
 */

const MB = 1024 * 1024;

/** 文本进编辑器、Markdown、HTML 预览的上限。超出只返回元数据。 */
export const TEXT_PREVIEW_LIMIT = 512 * 1024;

/** 扩展名不在文本表里时，最多读这么多字节判断是不是文本。 */
export const TEXT_SNIFF_BYTES = 8192;

/**
 * 经 JSON 或 data URL 进出的单文件上限。
 * 附件 base64 落盘、桌面发送前校验、应用内图片预览共用这一个数。
 */
export const INLINE_FILE_BYTES = 15 * MB;

export const MAX_ATTACHMENT_BYTES = INLINE_FILE_BYTES;
export const IMAGE_PREVIEW_LIMIT = INLINE_FILE_BYTES;
export const MAX_INLINE_IMAGE_BYTES = INLINE_FILE_BYTES;

/**
 * 附件 JSON body 闸。base64 是原文的 4/3，再留 2MB 给其余字段。
 * 改 `INLINE_FILE_BYTES` 时这个上限跟着变。
 */
export const MAX_ATTACHMENT_BODY_BYTES = Math.ceil((INLINE_FILE_BYTES * 4) / 3) + 2 * MB;

/**
 * 按本地路径复制进 ATTACHMENTS 的上限。只占磁盘，不进 JSON。
 * 比应用内预览大：超大文件仍交给系统打开。
 */
export const MAX_ATTACHMENT_SOURCE_BYTES = 512 * MB;

export const MAX_ATTACHMENTS = 10;

/** 同一 mediaType 的第一条扩展名是落盘默认后缀（jpeg 用 .jpg）。 */
export const WORKSPACE_IMAGES = [
  { ext: ".png", mediaType: "image/png" },
  { ext: ".jpg", mediaType: "image/jpeg" },
  { ext: ".jpeg", mediaType: "image/jpeg" },
  { ext: ".gif", mediaType: "image/gif" },
  { ext: ".webp", mediaType: "image/webp" },
] as const;

export const WORKSPACE_IMAGE_MEDIA_TYPES = new Set<string>(
  WORKSPACE_IMAGES.map((item) => item.mediaType),
);

export const HTML_EXTENSIONS = [".html", ".htm"] as const;
export const MARKDOWN_EXTENSIONS = [".md", ".mdx", ".markdown"] as const;

const TEXT_EXTENSION_LIST = [
  ...MARKDOWN_EXTENSIONS,
  ...HTML_EXTENSIONS,
  ".txt",
  ".json",
  ".jsonl",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".py",
  ".css",
  ".yml",
  ".yaml",
  ".toml",
  ".xml",
  ".csv",
  ".sh",
  ".log",
  ".svg",
  ".mdc",
  ".gitignore",
] as const;

export const TEXT_EXTENSIONS = new Set<string>(TEXT_EXTENSION_LIST);

function baseName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return (slash === -1 ? normalized : normalized.slice(slash + 1)).toLowerCase();
}

function endsWithExtension(filePath: string, extensions: readonly string[]): boolean {
  const base = baseName(filePath);
  return extensions.some((ext) => base.endsWith(ext));
}

export function imageMediaTypeForExtension(ext: string): string | undefined {
  const key = ext.toLowerCase();
  return WORKSPACE_IMAGES.find((item) => item.ext === key)?.mediaType;
}

/** 同一 MIME 的默认后缀。jpeg 取表里靠前的 .jpg。 */
export function defaultImageExtension(mediaType: string): string | undefined {
  return WORKSPACE_IMAGES.find((item) => item.mediaType === mediaType)?.ext;
}

export function isWorkspaceImagePath(filePath: string): boolean {
  return endsWithExtension(
    filePath,
    WORKSPACE_IMAGES.map((item) => item.ext),
  );
}

export function isHtmlWorkspacePath(filePath: string): boolean {
  return endsWithExtension(filePath, HTML_EXTENSIONS);
}

export function isMarkdownWorkspacePath(filePath: string): boolean {
  return endsWithExtension(filePath, MARKDOWN_EXTENSIONS);
}
