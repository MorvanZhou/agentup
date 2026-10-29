import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ImageContent } from "@earendil-works/pi-ai";

import { ATTACHMENTS_DIR } from "./cwd-layout.js";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_SOURCE_BYTES,
  MAX_ATTACHMENTS,
  WORKSPACE_IMAGE_MEDIA_TYPES,
  defaultImageExtension,
} from "./media.js";
import { isBlockedPath } from "./project-roots.js";

export { ATTACHMENTS_DIR };
export {
  MAX_ATTACHMENT_BODY_BYTES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_SOURCE_BYTES,
  MAX_ATTACHMENTS,
} from "./media.js";
/** 目录 staging：树内常规文件数上限（与运行包文件数闸门同量级）。 */
export const MAX_ATTACHMENT_TREE_FILES = 200;

/** 每轮注入的附件绝对路径注记（Pi nextTurn custom message）。 */
export const ATTACHMENT_PATHS_CUSTOM_TYPE = "agentup.attachment_paths";

/**
 * 正文里的 `@ATTACHMENTS/...` 引用（无 @，目录带尾 `/`），按首次出现去重。
 * 与 Desktop `attachment-ref.ts` 的芯片解析同构：扁平 / 旧嵌套 / 目录尾斜杠都认。
 */
const ATTACHMENT_REF_RE =
  /(^|[\s([{（【])@(ATTACHMENTS\/(?:[A-Za-z0-9._-]+\/)?[^\s@/]+\/?)(?=$|[\s,.;:!?，。；：！？)\]}）】])/g;

export function attachmentRefsInText(text: string): string[] {
  if (!text) return [];
  const refs: string[] = [];
  for (const match of text.matchAll(ATTACHMENT_REF_RE)) {
    const ref = match[2] ?? "";
    if (ref && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

/**
 * 芯片 → 绝对路径注记：正文里的 `@ATTACHMENTS/...` 只是 cwd 相对 token，
 * 这里把每个仍存在于磁盘的引用映射成绝对路径，供 nextTurn 注入（display:false，
 * 不改用户落盘原文）。只注路径，不展开目录内容摘要。
 */
export function formatAttachmentLocations(cwd: string, refs: readonly string[]): string {
  const lines: string[] = [];
  for (const ref of refs) {
    const absolute = path.resolve(cwd, ref.replace(/\/+$/, ""));
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolute);
    } catch {
      continue;
    }
    if (!stat.isFile() && !stat.isDirectory()) continue;
    const kind = stat.isDirectory() ? " (directory)" : "";
    lines.push(`- \`${ref}\`${kind} → ${absolute}`);
  }
  if (lines.length === 0) return "";
  return [
    "# Attachment paths",
    "",
    "`@ATTACHMENTS/...` references in the user message are staged in this workspace:",
    ...lines,
  ].join("\n");
}

export type PromptAttachment = {
  name: string;
  mediaType: string;
  dataBase64: string;
};

export type StagedAttachment = {
  id: string;
  /** cwd 相对路径：扁平 `ATTACHMENTS/<id>-<name>`（兼容旧 `ATTACHMENTS/<id>/<name>`） */
  path: string;
  /** 写入 Composer 的标记，如 @ATTACHMENTS/<id>-note.txt */
  ref: string;
  name: string;
  mediaType: string;
};

export class AttachmentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** 从 prompt body 解析 attachments（兼容 images 字段）。 */
export function parsePromptAttachments(body: Record<string, unknown>): PromptAttachment[] {
  const raw = body.attachments ?? body.images;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new AttachmentError("附件格式无效");
  if (raw.length > MAX_ATTACHMENTS) throw new AttachmentError(`附件最多 ${MAX_ATTACHMENTS} 个`);

  const result: PromptAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") throw new AttachmentError("附件格式无效");
    const record = item as Record<string, unknown>;
    const mediaType = normalizeMediaType(
      typeof record.media_type === "string"
        ? record.media_type
        : typeof record.mediaType === "string"
          ? record.mediaType
          : typeof record.mimeType === "string"
            ? record.mimeType
            : "",
    );
    const dataBase64 = stripDataUrl(
      typeof record.data_base64 === "string"
        ? record.data_base64
        : typeof record.dataBase64 === "string"
          ? record.dataBase64
          : typeof record.data === "string"
            ? record.data
            : "",
    );
    const name = sanitizeAttachmentFileName(
      typeof record.name === "string"
        ? record.name
        : typeof record.filename === "string"
          ? record.filename
          : typeof record.fileName === "string"
            ? record.fileName
            : defaultName(mediaType, result.length),
    );
    if (!mediaType || !dataBase64) throw new AttachmentError("附件缺少类型或内容");
    if (!/^[A-Za-z0-9+/=\s]+$/.test(dataBase64)) throw new AttachmentError("附件编码无效");
    const bytes = Buffer.from(dataBase64, "base64");
    if (bytes.length === 0) throw new AttachmentError("附件内容为空");
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new AttachmentError(`附件过大（上限 ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB）`);
    }
    result.push({ name, mediaType, dataBase64: bytes.toString("base64") });
  }
  return result;
}

/**
 * Composer 选文件瞬间落盘：扁平写入 `cwd/ATTACHMENTS/<stem>_<id>.<ext>`，
 * 避免每个文件一个子文件夹。
 */
export function stageAttachment(cwd: string, attachment: PromptAttachment): StagedAttachment {
  const id = newAttachmentId();
  const fileName = sanitizeAttachmentFileName(attachment.name);
  const storedName = withIdSuffix(fileName, id);
  const dir = path.join(cwd, ATTACHMENTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const absolute = uniqueAbsolute(path.join(dir, storedName));
  fs.writeFileSync(absolute, Buffer.from(attachment.dataBase64, "base64"));
  const relative = `${ATTACHMENTS_DIR}/${path.basename(absolute)}`;
  return {
    id,
    path: relative,
    ref: `@${relative}`,
    name: fileName,
    mediaType: attachment.mediaType,
  };
}

/**
 * 按本地磁盘路径直接复制 staging（免 base64 转码，支持大文件 / 目录）。
 * 源必须是与 runtime 同机的常规文件或目录；拒符号链接，与
 * `security` 的「读源拒符号链接」一致。空文件拒绝；空目录允许。
 * 目录落盘为 `ATTACHMENTS/<name>_<id>/`（path 带尾 `/`，供 FileChip 识别）。
 * `maxBytes` 供测试注入小上限。
 */
export function stageAttachmentFromPath(
  cwd: string,
  source: { path: string; name?: string; mediaType?: string },
  options: { maxBytes?: number } = {},
): StagedAttachment {
  const maxBytes = options.maxBytes ?? MAX_ATTACHMENT_SOURCE_BYTES;
  const resolved = path.resolve(source.path);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new AttachmentError("路径无效", 400);
  }
  if (stat.isSymbolicLink()) throw new AttachmentError("路径无效", 400);
  // 敏感根（~/.ssh、/etc 等）与 project_roots 挂载共用同一套拒绝判定
  if (isBlockedPath(resolved)) throw new AttachmentError("路径无效", 400);

  if (stat.isDirectory()) {
    return stageDirectoryFromPath(cwd, resolved, source, maxBytes);
  }
  if (!stat.isFile()) throw new AttachmentError("路径无效", 400);
  if (stat.size === 0) throw new AttachmentError("附件内容为空");
  if (stat.size > maxBytes) {
    throw new AttachmentError(`附件过大（上限 ${Math.floor(maxBytes / (1024 * 1024))}MB）`);
  }
  const fileName = sanitizeAttachmentFileName(source.name || path.basename(resolved));
  const id = newAttachmentId();
  const storedName = withIdSuffix(fileName, id);
  const dir = path.join(cwd, ATTACHMENTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const absolute = uniqueAbsolute(path.join(dir, storedName));
  // 直接复制：字节不经 JSON / base64，内存占用与文件大小无关
  fs.copyFileSync(resolved, absolute);
  const relative = `${ATTACHMENTS_DIR}/${path.basename(absolute)}`;
  return {
    id,
    path: relative,
    ref: `@${relative}`,
    name: fileName,
    mediaType: normalizeMediaType(source.mediaType || "") || "application/octet-stream",
  };
}

function stageDirectoryFromPath(
  cwd: string,
  resolved: string,
  source: { name?: string; mediaType?: string },
  maxBytes: number,
): StagedAttachment {
  assertCopyableTree(resolved, maxBytes);
  const dirName = sanitizeAttachmentFileName(source.name || path.basename(resolved));
  const id = newAttachmentId();
  // 目录无扩展名：withIdSuffix → `name_<id>`
  const storedName = withIdSuffix(dirName, id);
  const dir = path.join(cwd, ATTACHMENTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const absolute = uniqueAbsolute(path.join(dir, storedName));
  fs.cpSync(resolved, absolute, { recursive: true, errorOnExist: true });
  // 尾 `/` 标记目录，Composer FileChip / 引用解析据此显示文件夹图标
  const relative = `${ATTACHMENTS_DIR}/${path.basename(absolute)}/`;
  return {
    id,
    path: relative,
    ref: `@${relative}`,
    name: dirName,
    mediaType: "inode/directory",
  };
}

/** 预检目录树：拒符号链接 / 非常规节点，合计体积与文件数封顶。 */
function assertCopyableTree(root: string, maxBytes: number): void {
  let total = 0;
  let files = 0;
  const walk = (current: string): void => {
    for (const name of fs.readdirSync(current)) {
      const next = path.join(current, name);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(next);
      } catch {
        throw new AttachmentError("路径无效", 400);
      }
      if (st.isSymbolicLink()) throw new AttachmentError("路径无效", 400);
      if (st.isDirectory()) {
        walk(next);
        continue;
      }
      if (!st.isFile()) throw new AttachmentError("路径无效", 400);
      files += 1;
      if (files > MAX_ATTACHMENT_TREE_FILES) {
        throw new AttachmentError(`目录文件过多（上限 ${MAX_ATTACHMENT_TREE_FILES} 个）`);
      }
      total += st.size;
      if (total > maxBytes) {
        throw new AttachmentError(`附件过大（上限 ${Math.floor(maxBytes / (1024 * 1024))}MB）`);
      }
    }
  };
  walk(root);
}

/** 删除 staging 文件或目录；允许扁平或旧版嵌套路径。 */
export function removeStagedAttachment(cwd: string, relativePath: string): void {
  const relative = normalizeAttachmentRelative(relativePath);
  const absolute = path.resolve(cwd, relative);
  const root = path.resolve(cwd, ATTACHMENTS_DIR);
  if (!absolute.startsWith(root + path.sep) && absolute !== root) {
    throw new AttachmentError("路径无效", 400);
  }
  if (!fs.existsSync(absolute)) return;
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new AttachmentError("路径无效", 400);
  if (stat.isDirectory()) {
    fs.rmSync(absolute, { recursive: true, force: true });
    return;
  }
  if (!stat.isFile()) throw new AttachmentError("路径无效", 400);
  fs.unlinkSync(absolute);
  // 旧版嵌套目录：删空后收掉
  const dir = path.dirname(absolute);
  if (dir !== root) {
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
}

/**
 * 发送时仅处理图片：落盘（便于工作空间查看）并返回 Pi ImageContent。
 * 不再追加 `[附件已保存]`，也不再 inline 文本文件。
 */
export function materializePromptImages(
  cwd: string,
  attachments: readonly PromptAttachment[],
): ImageContent[] {
  const images: ImageContent[] = [];
  for (const attachment of attachments) {
    if (!WORKSPACE_IMAGE_MEDIA_TYPES.has(attachment.mediaType)) continue;
    stageAttachment(cwd, attachment);
    images.push({
      type: "image",
      data: attachment.dataBase64,
      mimeType: attachment.mediaType,
    });
  }
  return images;
}

/** 短 id，足够区分且目录列表可读。 */
export function newAttachmentId(): string {
  return randomBytes(4).toString("hex");
}

/**
 * 存名加 id 后缀：`note.txt` → `note_<id>.txt`。扩展名保持在尾部，
 * Finder / 列表按类型排序与预览不受影响；`<id>-<name>` 为历史前缀格式。
 */
function withIdSuffix(fileName: string, id: string): string {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  return `${stem || "file"}_${id}${ext}`;
}

function normalizeAttachmentRelative(value: string): string {
  // 目录芯片 path 带尾 `/`；校验时剥掉再拼回无尾斜杠的磁盘相对路径
  const trimmed = value.trim().replace(/^@/, "").replace(/\/+$/, "");
  if (!trimmed.startsWith(`${ATTACHMENTS_DIR}/`)) throw new AttachmentError("路径无效", 400);
  if (trimmed.includes("\0") || trimmed.includes("..")) throw new AttachmentError("路径无效", 400);
  const parts = trimmed.split("/");
  // 扁平 ATTACHMENTS/file|dir 或旧版 ATTACHMENTS/id/file
  if (parts.length === 2 && parts[1]) return trimmed;
  if (parts.length === 3 && parts[1] && parts[2]) return trimmed;
  throw new AttachmentError("路径无效", 400);
}

/**
 * 落盘与 `@ATTACHMENTS/...` 芯片共用：去掉空白，避免正文 token 被空格截断。
 * `my note.txt` → `my_note.txt`
 */
export function sanitizeAttachmentFileName(value: string): string {
  const base = path
    .basename(value.trim() || "file")
    .replace(/[\u0000-\u001f<>:"|?*\\/]/g, "_")
    // 含普通空格、全角空格、不间断空格等
    .replace(/[\s\u00a0\u3000]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const cleaned = base.replace(/^\.+/, "") || "file";
  return cleaned.slice(0, 180);
}

function uniqueAbsolute(target: string): string {
  if (!fs.existsSync(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const stem = path.basename(target, ext);
  let n = 2;
  while (true) {
    const next = path.join(dir, `${stem}-${n}${ext}`);
    if (!fs.existsSync(next)) return next;
    n += 1;
  }
}

function defaultName(mediaType: string, index: number): string {
  const ext =
    defaultImageExtension(mediaType) ??
    (mediaType === "application/json" ? ".json" : mediaType.startsWith("text/") ? ".txt" : ".bin");
  return `attachment-${index + 1}${ext}`;
}

function normalizeMediaType(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return "";
  if (raw === "image/jpg") return "image/jpeg";
  return raw.split(";")[0]?.trim() ?? "";
}

function stripDataUrl(value: string): string {
  const trimmed = value.trim();
  const match = /^data:[^;]+;base64,(.+)$/s.exec(trimmed);
  return (match?.[1] ?? trimmed).replace(/\s+/g, "");
}
