/**
 * 本地路径链旁的文件类型图标（Lucide 精简 path，供 v-html 内联；无法挂 Vue 组件）。
 */

function svg(body: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"',
    ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"',
    ' stroke-linejoin="round" class="aui-md-path-icon" aria-hidden="true">',
    body,
    "</svg>",
  ].join("");
}

/** Lucide: File */
const ICON_FILE = svg(
  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
);

/** Lucide: FileText */
const ICON_FILE_TEXT = svg(
  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
);

/** Lucide: FileCode */
const ICON_FILE_CODE = svg(
  '<path d="M10 12.5 8 15l2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>',
);

/** Lucide: FileImage */
const ICON_FILE_IMAGE = svg(
  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><circle cx="10" cy="12" r="2"/><path d="m20 17-1.09-1.09a2 2 0 0 0-2.82 0L10 22"/>',
);

/** Lucide: FileJson */
const ICON_FILE_JSON = svg(
  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"/><path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"/>',
);

/** Lucide: Folder */
const ICON_FOLDER = svg(
  '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
);

/** Lucide: FileArchive */
const ICON_ARCHIVE = svg(
  '<path d="M10 12v-1"/><path d="M10 18v-2"/><path d="M10 7V6"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M15.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v16a2 2 0 0 0 .274 1.01"/><circle cx="10" cy="20" r="2"/>',
);

const EXT_ICON: Record<string, string> = {
  md: ICON_FILE_TEXT,
  mdx: ICON_FILE_TEXT,
  markdown: ICON_FILE_TEXT,
  txt: ICON_FILE_TEXT,
  rst: ICON_FILE_TEXT,
  log: ICON_FILE_TEXT,

  png: ICON_FILE_IMAGE,
  jpg: ICON_FILE_IMAGE,
  jpeg: ICON_FILE_IMAGE,
  gif: ICON_FILE_IMAGE,
  webp: ICON_FILE_IMAGE,
  svg: ICON_FILE_IMAGE,
  ico: ICON_FILE_IMAGE,
  bmp: ICON_FILE_IMAGE,

  ts: ICON_FILE_CODE,
  tsx: ICON_FILE_CODE,
  js: ICON_FILE_CODE,
  jsx: ICON_FILE_CODE,
  mjs: ICON_FILE_CODE,
  cjs: ICON_FILE_CODE,
  vue: ICON_FILE_CODE,
  py: ICON_FILE_CODE,
  go: ICON_FILE_CODE,
  rs: ICON_FILE_CODE,
  java: ICON_FILE_CODE,
  kt: ICON_FILE_CODE,
  c: ICON_FILE_CODE,
  cc: ICON_FILE_CODE,
  cpp: ICON_FILE_CODE,
  h: ICON_FILE_CODE,
  hpp: ICON_FILE_CODE,
  cs: ICON_FILE_CODE,
  css: ICON_FILE_CODE,
  scss: ICON_FILE_CODE,
  less: ICON_FILE_CODE,
  html: ICON_FILE_CODE,
  htm: ICON_FILE_CODE,
  sh: ICON_FILE_CODE,
  bash: ICON_FILE_CODE,
  zsh: ICON_FILE_CODE,
  ps1: ICON_FILE_CODE,
  sql: ICON_FILE_CODE,

  json: ICON_FILE_JSON,
  jsonc: ICON_FILE_JSON,
  yaml: ICON_FILE_JSON,
  yml: ICON_FILE_JSON,
  toml: ICON_FILE_JSON,
  xml: ICON_FILE_JSON,

  zip: ICON_ARCHIVE,
  tar: ICON_ARCHIVE,
  gz: ICON_ARCHIVE,
  tgz: ICON_ARCHIVE,
  rar: ICON_ARCHIVE,
  "7z": ICON_ARCHIVE,
};

/** 按路径扩展名（或目录尾 `/`）返回内联 SVG；供 markdown-it 写入 `<a>` 内。 */
export function localPathIconHtml(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) return ICON_FILE;
  if (trimmed.endsWith("/") || trimmed.endsWith("\\")) return ICON_FOLDER;
  const base = trimmed.split(/[/\\]/).pop() ?? trimmed;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return ICON_FILE;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_ICON[ext] ?? ICON_FILE;
}
