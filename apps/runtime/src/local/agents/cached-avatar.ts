import fs from "node:fs";
import path from "node:path";

import { isLocalAgentId } from "./local-agent.js";

const MAX_BYTES = 1_048_576;
const SEGMENT = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
/** 记录缓存对应的远程 URL（含 ?v=）；版本变了则重拉。 */
const SOURCE_FILE = "source.url";

/** 市场 Agent 头像本机缓存：`users/<uid>/agents/<id>/assets/avatar.(webp|png|jpg)` */
export function cachedAvatarDir(userDataRoot: string, userId: string, agentId: string): string | null {
  if (!safeSegment(userId) || !safeSegment(agentId) || isLocalAgentId(agentId)) return null;
  return path.join(userDataRoot, "users", userId, "agents", agentId, "assets");
}

export function readCachedAvatarDataUrl(
  userDataRoot: string,
  userId: string,
  agentId: string,
): string | undefined {
  const dir = cachedAvatarDir(userDataRoot, userId, agentId);
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

/**
 * 把 data URL 头像写入本机缓存（覆盖旧文件）。
 * `sourceUrl` 有值时一并记下，供 ensureCachedAvatar 判断是否还需重拉。
 */
export function writeCachedAvatarDataUrl(
  userDataRoot: string,
  userId: string,
  agentId: string,
  dataUrl: string,
  sourceUrl?: string,
): string | undefined {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) return undefined;
  const mime = match[1]!;
  const bytes = Buffer.from(match[2]!.replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) return undefined;
  const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const dir = cachedAvatarDir(userDataRoot, userId, agentId);
  if (!dir) return undefined;
  writeAvatarFiles(dir, bytes, extension, sourceUrl);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/**
 * 从远程 URL 拉一头像落到本机。
 * 带 `?v=`（或 `&v=`）且 `source.url` 未变则跳过；无版本号时每次尝试重拉
 * （兼容尚未部署 mtime cache-bust 的控制面，避免永久卡在旧图）。
 * 失败时尽量回落已有缓存。
 */
export async function ensureCachedAvatar(
  userDataRoot: string,
  userId: string,
  agentId: string,
  remoteUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const existing = readCachedAvatarDataUrl(userDataRoot, userId, agentId);
  const normalizedRemote = remoteUrl?.trim() ?? "";
  const versioned = /[?&]v=/.test(normalizedRemote);
  if (
    existing &&
    normalizedRemote &&
    versioned &&
    readCachedSourceUrl(userDataRoot, userId, agentId) === normalizedRemote
  ) {
    return existing;
  }
  // 无 remote：保留现有，避免离线被清空
  if (!normalizedRemote) return existing;
  const dir = cachedAvatarDir(userDataRoot, userId, agentId);
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
  agentId: string,
): string | undefined {
  const dir = cachedAvatarDir(userDataRoot, userId, agentId);
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

function safeSegment(value: string): boolean {
  return Boolean(value) && value !== "." && value !== ".." && !/[/\\\u0000]/.test(value) && SEGMENT.test(value);
}
