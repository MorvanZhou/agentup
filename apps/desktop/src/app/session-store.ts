import type { Session } from "../shared/model/runtime/runtime";
import { GUEST_SESSION, isGuestSession } from "../shared/model/session/session";

const LEGACY_KEY = "agentup.session";

let cached: Session | null | undefined;

/** 测试用：清掉内存缓存，下一次 restoreSession 会重新读取。 */
export function resetSessionStore(): void {
  cached = undefined;
}

export function parseSession(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Session;
  if (
    typeof candidate.userId !== "string" ||
    !candidate.userId ||
    typeof candidate.token !== "string" ||
    !candidate.token ||
    typeof candidate.nickname !== "string" ||
    !candidate.nickname ||
    typeof candidate.email !== "string"
  ) {
    return null;
  }
  const kind =
    candidate.kind === "guest" || candidate.userId === "guest" || isGuestSession(candidate)
      ? "guest"
      : "account";
  if (kind === "account" && !candidate.email) return null;
  const hasAvatar = candidate.hasAvatar === true;
  const avatarUrl =
    typeof candidate.avatarUrl === "string" && candidate.avatarUrl.trim()
      ? candidate.avatarUrl.trim()
      : undefined;
  return {
    kind,
    userId: candidate.userId,
    email: candidate.email,
    nickname: candidate.nickname,
    token: candidate.token,
    ...(hasAvatar ? { hasAvatar: true } : {}),
    ...(hasAvatar && avatarUrl ? { avatarUrl } : {}),
  };
}

function readLegacy(): Session | null {
  const raw = localStorage.getItem(LEGACY_KEY) ?? sessionStorage.getItem(LEGACY_KEY);
  if (!raw) return null;
  try {
    return parseSession(JSON.parse(raw) as Session);
  } catch {
    return null;
  }
}

function clearLegacy(): void {
  localStorage.removeItem(LEGACY_KEY);
  sessionStorage.removeItem(LEGACY_KEY);
}

function bridge() {
  return window.agentUp;
}

async function load(): Promise<Session | null> {
  const api = bridge();
  if (api?.readSession) {
    const fromVault = parseSession(await api.readSession());
    if (fromVault) return fromVault;
    const legacy = readLegacy();
    if (legacy && api.saveSession) {
      await api.saveSession(legacy);
      clearLegacy();
      return legacy;
    }
    clearLegacy();
    return null;
  }
  return readLegacy();
}

/** 启动时调用一次，之后 readSession 同步读缓存。 */
export async function restoreSession(): Promise<Session | null> {
  if (cached !== undefined) return cached;
  cached = await load();
  return cached;
}

/** 无会话时写入游客身份（冷启动进主界面）。 */
export async function ensureGuestSession(): Promise<Session> {
  const current = cached === undefined ? await restoreSession() : cached;
  if (current) return current;
  await saveSession(GUEST_SESSION);
  return GUEST_SESSION;
}

export function readSession(): Session | null {
  return cached ?? null;
}

export async function saveSession(session: Session): Promise<void> {
  const normalized = parseSession(session);
  if (!normalized) throw new Error("登录态无效");
  cached = normalized;
  const api = bridge();
  if (api?.saveSession) {
    clearLegacy();
    await api.saveSession(normalized);
    return;
  }
  localStorage.setItem(LEGACY_KEY, JSON.stringify(normalized));
  sessionStorage.removeItem(LEGACY_KEY);
}

export async function clearSession(): Promise<void> {
  cached = null;
  clearLegacy();
  const api = bridge();
  if (api?.clearSession) await api.clearSession();
}
