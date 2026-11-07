import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import * as tar from "tar";

/** 与 backend `core/limits.py` 对齐。安装侧在写盘前用这些上限拒绝压缩炸弹。 */
const ARCHIVE_MAX_PATH_LENGTH = 200;
const ARCHIVE_MAX_PATH_DEPTH = 8;
const BLOCK = 512;

export interface ArchiveLimits {
  maxBytes: number;
  maxUnpackedBytes: number;
  maxFileBytes: number;
  maxFileCount: number;
  maxMemberCount: number;
}

/** 旧整包：压缩和解压都是 20MB，文件数 300。 */
export const LEGACY_ARCHIVE_LIMITS: ArchiveLimits = {
  maxBytes: 20 * 1024 * 1024,
  maxUnpackedBytes: 20 * 1024 * 1024,
  maxFileBytes: 20 * 1024 * 1024,
  maxFileCount: 300,
  maxMemberCount: 600,
};

/** 单个 skill：压缩 20MB，解压 80MB，单文件 20MB，文件数 1000。 */
export const SKILL_ARCHIVE_LIMITS: ArchiveLimits = {
  maxBytes: 20 * 1024 * 1024,
  maxUnpackedBytes: 80 * 1024 * 1024,
  maxFileBytes: 20 * 1024 * 1024,
  maxFileCount: 1000,
  maxMemberCount: 2000,
};

/** hooks：压缩 2MB，解压 8MB，单文件 2MB，文件数 200。 */
export const HOOKS_ARCHIVE_LIMITS: ArchiveLimits = {
  maxBytes: 2 * 1024 * 1024,
  maxUnpackedBytes: 8 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxFileCount: 200,
  maxMemberCount: 400,
};

/** 把相对路径文件树打成 tar.gz。 */
export async function packTarGz(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pack-"));
  try {
    for (const [relative, content] of Object.entries(files)) {
      validateRelative(relative);
      const target = path.join(staging, ...relative.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    const out = path.join(staging, "package.tar.gz");
    const entries = Object.keys(files).sort();
    await tar.c({ gzip: true, file: out, cwd: staging, portable: true, mtime: new Date(0) }, entries);
    return new Uint8Array(fs.readFileSync(out));
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * 在内存里解开 tar.gz。拒绝链接、绝对路径、`..`、超限体积和超限文件数。
 * 不把条目写到磁盘；调用方校验通过后再落盘。
 */
export async function unpackTarGz(
  archive: Uint8Array,
  limits: ArchiveLimits = LEGACY_ARCHIVE_LIMITS,
): Promise<Record<string, Uint8Array>> {
  if (archive.byteLength < 1 || archive.byteLength > limits.maxBytes) {
    throw new Error("压缩包大小不符合限制");
  }
  if (archive[0] !== 0x1f || archive[1] !== 0x8b) {
    throw new Error("不是有效的 tar.gz");
  }
  const maxTarBytes = limits.maxUnpackedBytes + limits.maxMemberCount * BLOCK * 2;
  let raw: Buffer;
  try {
    raw = zlib.gunzipSync(archive, { maxOutputLength: maxTarBytes });
  } catch {
    throw new Error("解压失败或超过上限");
  }
  return parseUstar(raw, limits);
}

function parseUstar(raw: Buffer, limits: ArchiveLimits): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  let offset = 0;
  let members = 0;
  let unpacked = 0;
  while (offset + BLOCK <= raw.length) {
    const header = raw.subarray(offset, offset + BLOCK);
    offset += BLOCK;
    if (isZeroBlock(header)) break;
    members += 1;
    if (members > limits.maxMemberCount) throw new Error("条目数超过上限");
    if (!checksumOk(header)) throw new Error("压缩包头无效");
    const typeflag = header[156] ?? 0;
    const name = tarPath(header);
    const size = octal(header, 124, 12);
    if (size < 0 || size > limits.maxFileBytes) throw new Error("单文件超过上限");
    const dataEnd = offset + size;
    const next = offset + padded(size);
    if (next > raw.length) throw new Error("压缩包被截断");
    if (typeflag === 0 || typeflag === 48) {
      validateRelative(name);
      if (files[name]) throw new Error(`重复路径: ${name}`);
      if (Object.keys(files).length >= limits.maxFileCount) throw new Error("文件数超过上限");
      unpacked += size;
      if (unpacked > limits.maxUnpackedBytes) throw new Error("解压后超过上限");
      files[name] = new Uint8Array(raw.subarray(offset, dataEnd));
    } else if (typeflag === 53) {
      validateRelative(name.endsWith("/") ? name.slice(0, -1) : name);
    } else {
      throw new Error("不允许链接或非常规成员");
    }
    offset = next;
  }
  return files;
}

function tarPath(header: Buffer): string {
  const name = textField(header, 0, 100);
  const prefix = textField(header, 345, 155);
  return prefix ? `${prefix}/${name}` : name;
}

function textField(header: Buffer, start: number, length: number): string {
  const slice = header.subarray(start, start + length);
  const zero = slice.indexOf(0);
  return slice.subarray(0, zero === -1 ? length : zero).toString("utf8");
}

function octal(header: Buffer, start: number, length: number): number {
  const text = textField(header, start, length).trim();
  if (!text) return 0;
  const value = Number.parseInt(text, 8);
  return Number.isFinite(value) ? value : -1;
}

function padded(size: number): number {
  return Math.ceil(size / BLOCK) * BLOCK;
}

function isZeroBlock(header: Buffer): boolean {
  return header.every((byte) => byte === 0);
}

function checksumOk(header: Buffer): boolean {
  const recorded = octal(header, 148, 8);
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    sum += index >= 148 && index < 156 ? 32 : (header[index] ?? 0);
  }
  return sum === recorded;
}

function validateRelative(relative: string): void {
  const normalized = relative.replaceAll("\\", "/");
  if (
    !normalized
    || normalized.startsWith("/")
    || normalized.length > ARCHIVE_MAX_PATH_LENGTH
    || normalized.split("/").length > ARCHIVE_MAX_PATH_DEPTH
    || normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`非法路径: ${relative}`);
  }
}
