import fs from "node:fs";
import path from "node:path";

import { isLocalAgentId } from "./local-agent.js";

const MAX_BYTES = 1_048_576;
const SEGMENT = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

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

/** 从远程 URL 拉一头像落到本机；已有缓存则跳过。失败返回已有或 undefined。 */
export async function ensureCachedAvatar(
  userDataRoot: string,
  userId: string,
  agentId: string,
  remoteUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const existing = readCachedAvatarDataUrl(userDataRoot, userId, agentId);
  if (existing) return existing;
  if (!remoteUrl?.trim()) return undefined;
  const dir = cachedAvatarDir(userDataRoot, userId, agentId);
  if (!dir) return undefined;
  try {
    const response = await fetchImpl(remoteUrl);
    if (!response.ok) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES) return undefined;
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const { mime, extension } = resolveMime(contentType, bytes);
    if (!mime) return undefined;
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `avatar.${extension}`);
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    fs.renameSync(temporary, target);
    // 清掉其它扩展，避免多文件
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith("avatar.") && name !== `avatar.${extension}` && !name.endsWith(".tmp")) {
        try {
          fs.rmSync(path.join(dir, name), { force: true });
        } catch {
          /* ignore */
        }
      }
    }
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
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
