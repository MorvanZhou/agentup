import fs from "node:fs";
import path from "node:path";

import { isLocalAgentId } from "./local-agent.js";

const MAX_BYTES = 1_048_576;
const SEGMENT = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
/** 记录缓存对应的远程身份（pathname + 可选 ?v=）；签名 query 不计入。 */
const SOURCE_FILE = "source.url";

export type AvatarSubject = { kind: "agent"; agentId: string } | { kind: "user" };

export type EnsureCachedAvatarOptions = {
  fetch?: typeof fetch;
  /** 为 true 时即使身份未变也尝试重拉（登录 / 重启续签）。失败回落已有缓存。 */
  refresh?: boolean;
};

/**
 * 头像缓存身份：去掉 COS 签名等易变 query，保留路径与可选 `v=`。
 * 同 rev 的预签名 URL 轮换不会误判成「需要重拉」。
 */
export function avatarCacheKey(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const version = parsed.searchParams.get("v");
    return version ? `${parsed.pathname}?v=${version}` : parsed.pathname;
  } catch {
    const q = trimmed.indexOf("?");
    if (q < 0) return trimmed;
    const pathname = trimmed.slice(0, q);
    const version = new URLSearchParams(trimmed.slice(q + 1)).get("v");
    return version ? `${pathname}?v=${version}` : pathname;
  }
}

/** Agent：`users/<uid>/agents/<id>/assets/`；用户：`users/<uid>/account/assets/` */
export function cachedAvatarDir(
  userDataRoot: string,
  userId: string,
  subject: AvatarSubject | string,
): string | null {
  const resolved = normalizeSubject(subject);
  if (!resolved || !safeSegment(userId)) return null;
  if (resolved.kind === "user") {
    return path.join(userDataRoot, "users", userId, "account", "assets");
  }
  if (!safeSegment(resolved.agentId) || isLocalAgentId(resolved.agentId)) return null;
  return path.join(userDataRoot, "users", userId, "agents", resolved.agentId, "assets");
}

export function readCachedAvatarDataUrl(
  userDataRoot: string,
  userId: string,
  subject: AvatarSubject | string,
): string | undefined {
  const dir = cachedAvatarDir(userDataRoot, userId, subject);
  if (!dir || !fs.existsSync(dir)) return undefined;
  for (const name of ["avatar.webp", "avatar.png", "avatar.jpg", "avatar.jpeg"]) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    if (fs.lstatSync(file).isSymbolicLink()) continue;
    const bytes = fs.readFileSync(file);
    if (!bytes.length || bytes.length > MAX_BYTES) continue;
    const mime =
      name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }
  return undefined;
}

export function readCachedUserAvatarDataUrl(
  userDataRoot: string,
  userId: string,
): string | undefined {
  return readCachedAvatarDataUrl(userDataRoot, userId, { kind: "user" });
}

/**
 * 把 data URL 头像写入本机缓存（覆盖旧文件）。
 * `sourceUrl` 有值时一并记下，供 ensure 判断是否还需重拉。
 */
export function writeCachedAvatarDataUrl(
  userDataRoot: string,
  userId: string,
  subject: AvatarSubject | string,
  dataUrl: string,
  sourceUrl?: string,
): string | undefined {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) return undefined;
  const mime = match[1]!;
  const bytes = Buffer.from(match[2]!.replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) return undefined;
  const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const dir = cachedAvatarDir(userDataRoot, userId, subject);
  if (!dir) return undefined;
  writeAvatarFiles(dir, bytes, extension, sourceUrl);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export function writeCachedUserAvatarDataUrl(
  userDataRoot: string,
  userId: string,
  dataUrl: string,
  sourceUrl?: string,
): string | undefined {
  return writeCachedAvatarDataUrl(userDataRoot, userId, { kind: "user" }, dataUrl, sourceUrl);
}

/**
 * 从远程 URL 拉一头像落到本机。
 * 身份（pathname / ?v=）未变且未要求 refresh 则跳过；失败时回落已有缓存。
 */
export async function ensureCachedAvatar(
  userDataRoot: string,
  userId: string,
  subject: AvatarSubject | string,
  remoteUrl: string | undefined,
  options: EnsureCachedAvatarOptions = {},
): Promise<string | undefined> {
  const fetchImpl = options.fetch ?? fetch;
  const refresh = options.refresh === true;
  const existing = readCachedAvatarDataUrl(userDataRoot, userId, subject);
  const normalizedRemote = remoteUrl?.trim() ?? "";
  const remoteKey = avatarCacheKey(normalizedRemote);
  const storedKey = avatarCacheKey(readCachedSourceUrl(userDataRoot, userId, subject) ?? "");
  if (existing && remoteKey && !refresh && storedKey && storedKey === remoteKey) {
    return existing;
  }
  // 无 remote：保留现有，避免离线被清空
  if (!normalizedRemote) return existing;
  const dir = cachedAvatarDir(userDataRoot, userId, subject);
  if (!dir) return existing;
  try {
    const response = await fetchImpl(normalizedRemote);
    if (!response.ok) return existing;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES) return existing;
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const { mime, extension } = resolveMime(contentType, bytes);
    if (!mime) return existing;
    writeAvatarFiles(dir, bytes, extension, normalizedRemote);
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return existing;
  }
}

export async function ensureCachedUserAvatar(
  userDataRoot: string,
  userId: string,
  remoteUrl: string | undefined,
  options: EnsureCachedAvatarOptions = {},
): Promise<string | undefined> {
  return ensureCachedAvatar(userDataRoot, userId, { kind: "user" }, remoteUrl, options);
}

function writeAvatarFiles(
  dir: string,
  bytes: Buffer,
  extension: string,
  sourceUrl: string | undefined,
): void {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `avatar.${extension}`);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, target);
  for (const name of fs.readdirSync(dir)) {
    if (name === SOURCE_FILE) continue;
    if (name.startsWith("avatar.") && name !== `avatar.${extension}` && !name.endsWith(".tmp")) {
      try {
        fs.rmSync(path.join(dir, name), { force: true });
      } catch {
        /* ignore */
      }
    }
  }
  if (sourceUrl?.trim()) {
    const sourceTmp = path.join(dir, `${SOURCE_FILE}.tmp`);
    fs.writeFileSync(sourceTmp, sourceUrl.trim(), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(sourceTmp, path.join(dir, SOURCE_FILE));
  } else {
    try {
      fs.rmSync(path.join(dir, SOURCE_FILE), { force: true });
    } catch {
      /* ignore */
    }
  }
}

function readCachedSourceUrl(
  userDataRoot: string,
  userId: string,
  subject: AvatarSubject | string,
): string | undefined {
  const dir = cachedAvatarDir(userDataRoot, userId, subject);
  if (!dir) return undefined;
  const file = path.join(dir, SOURCE_FILE);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return undefined;
  if (fs.lstatSync(file).isSymbolicLink()) return undefined;
  const text = fs.readFileSync(file, "utf8").trim();
  return text || undefined;
}

function resolveMime(
  contentType: string,
  bytes: Buffer,
): { mime: string; extension: string } | { mime: null; extension: null } {
  if (
    contentType === "image/webp" ||
    (bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP")
  ) {
    return { mime: "image/webp", extension: "webp" };
  }
  if (
    contentType === "image/png" ||
    (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
  ) {
    return { mime: "image/png", extension: "png" };
  }
  if (
    contentType === "image/jpeg" ||
    (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
  ) {
    return { mime: "image/jpeg", extension: "jpg" };
  }
  return { mime: null, extension: null };
}

function normalizeSubject(subject: AvatarSubject | string): AvatarSubject | null {
  if (typeof subject === "string") {
    if (!subject) return null;
    return { kind: "agent", agentId: subject };
  }
  if (subject.kind === "user") return subject;
  if (subject.kind === "agent" && subject.agentId) return subject;
  return null;
}

function safeSegment(value: string): boolean {
  return Boolean(value) && value !== "." && value !== ".." && !/[/\\\u0000]/.test(value) && SEGMENT.test(value);
}
