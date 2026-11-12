import type { Session } from "../../model/runtime/runtime";

import { DesktopApiError } from "./error";
import type { RuntimeHttp } from "./http";

/** 本机测例 / 调试用；产品登录走浏览器 oauth exchange。 */
export async function login(
  http: RuntimeHttp,
  email: string,
  password: string,
): Promise<Session> {
  return session(http, "/login", { email, password });
}

export async function oauthExchange(http: RuntimeHttp, code: string): Promise<Session> {
  return session(http, "/auth/oauth/exchange", { code });
}

/** 打开 Web 改密页前：用本机会话换一次性 bridge 码。 */
export async function desktopHandoff(http: RuntimeHttp, token: string): Promise<string> {
  const payload = await http.request("/auth/desktop/handoff", token, {}, "POST");
  if (typeof payload.code !== "string" || !payload.code.trim()) {
    throw new DesktopApiError("handoff 响应无效");
  }
  return payload.code.trim();
}

/** 向控制面续签会话头像，runtime 会写成 data URL。 */
export async function fetchMe(http: RuntimeHttp, token: string): Promise<Session> {
  const payload = await http.request("/me", token, undefined, "GET");
  return readSession(payload, "账号资料响应无效");
}

/** 只读本机用户头像缓存（vault 仍是过期签名 URL 时的回落）。 */
export async function accountAvatar(
  http: RuntimeHttp,
  userId: string,
): Promise<string | undefined> {
  const payload = await http.request(
    `/local/account-avatar?user_id=${encodeURIComponent(userId)}`,
    undefined,
    undefined,
    "GET",
  );
  return typeof payload.avatar_url === "string" && payload.avatar_url.trim()
    ? payload.avatar_url.trim()
    : undefined;
}

export async function updateProfile(
  http: RuntimeHttp,
  token: string,
  nickname: string,
  options: { avatarBase64?: string } = {},
): Promise<Session> {
  const body: Record<string, string> = { nickname };
  if (options.avatarBase64) body.avatar = options.avatarBase64;
  const payload = await http.request("/me", token, body, "PUT");
  return readSession(payload, "账号资料响应无效");
}

export async function migrateGuestUser(
  http: RuntimeHttp,
  token: string,
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  await http.request(
    "/local/migrate-user",
    token,
    { from_user_id: fromUserId, to_user_id: toUserId },
    "POST",
  );
}

async function session(
  http: RuntimeHttp,
  path: string,
  body: Record<string, string>,
): Promise<Session> {
  const payload = await http.request(path, undefined, body);
  return readSession(payload, "登录响应无效");
}

function readSession(payload: Record<string, unknown>, invalidMessage: string): Session {
  if (
    typeof payload.user_id !== "string" ||
    typeof payload.email !== "string" ||
    typeof payload.nickname !== "string" ||
    typeof payload.token !== "string"
  ) {
    throw new DesktopApiError(invalidMessage);
  }
  const hasAvatar = payload.has_avatar === true;
  const avatarUrl =
    typeof payload.avatar_url === "string" && payload.avatar_url.trim()
      ? payload.avatar_url.trim()
      : undefined;
  return {
    kind: "account",
    userId: payload.user_id,
    email: payload.email,
    nickname: payload.nickname,
    token: payload.token,
    ...(hasAvatar ? { hasAvatar: true } : {}),
    ...(hasAvatar && avatarUrl ? { avatarUrl } : {}),
  };
}
