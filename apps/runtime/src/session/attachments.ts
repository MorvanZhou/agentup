import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ImageContent } from "@earendil-works/pi-ai";

import { ATTACHMENTS_DIR } from "./cwd-layout.js";

export { ATTACHMENTS_DIR };
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

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
 * Composer 选文件瞬间落盘：扁平写入 `cwd/ATTACHMENTS/<id>-<name>`，
 * 避免每个文件一个子文件夹。
 */
export function stageAttachment(cwd: string, attachment: PromptAttachment): StagedAttachment {
  const id = newAttachmentId();
  const fileName = sanitizeAttachmentFileName(attachment.name);
  const storedName = `${id}-${fileName}`;
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

/** 删除 staging 文件；允许扁平或旧版嵌套路径。 */
export function removeStagedAttachment(cwd: string, relativePath: string): void {
  const relative = normalizeAttachmentRelative(relativePath);
  const absolute = path.resolve(cwd, relative);
  const root = path.resolve(cwd, ATTACHMENTS_DIR);
  if (!absolute.startsWith(root + path.sep) && absolute !== root) {
    throw new AttachmentError("路径无效", 400);
  }
  if (!fs.existsSync(absolute)) return;
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new AttachmentError("路径无效", 400);
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
    if (!IMAGE_MIME.has(attachment.mediaType)) continue;
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

function normalizeAttachmentRelative(value: string): string {
  const trimmed = value.trim().replace(/^@/, "");
  if (!trimmed.startsWith(`${ATTACHMENTS_DIR}/`)) throw new AttachmentError("路径无效", 400);
  if (trimmed.includes("\0") || trimmed.includes("..")) throw new AttachmentError("路径无效", 400);
  const parts = trimmed.split("/");
  // 扁平 ATTACHMENTS/file 或旧版 ATTACHMENTS/id/file
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
    mediaType === "image/png"
      ? ".png"
      : mediaType === "image/jpeg"
        ? ".jpg"
        : mediaType === "image/gif"
          ? ".gif"
          : mediaType === "image/webp"
            ? ".webp"
            : mediaType === "application/json"
              ? ".json"
              : mediaType.startsWith("text/")
                ? ".txt"
                : ".bin";
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
