import type { Session } from "../../model/runtime/runtime";

import { DesktopApiError } from "./error";
import type { RuntimeHttp } from "./http";

export type RegisterPending = {
  email: string;
  status: "pending_verification";
};

export type TurnstileInfo = {
  siteKey: string;
  required: boolean;
};

export async function register(
  http: RuntimeHttp,
  email: string,
  password: string,
  turnstileToken = "",
): Promise<RegisterPending> {
  const payload = await http.request("/register", undefined, {
    email,
    password,
    turnstile_token: turnstileToken,
  });
  if (typeof payload.email !== "string" || payload.status !== "pending_verification") {
    throw new DesktopApiError("注册响应无效");
  }
  return { email: payload.email, status: "pending_verification" };
}

export async function login(
  http: RuntimeHttp,
  email: string,
  password: string,
): Promise<Session> {
  return session(http, "/login", { email, password });
}

export async function resendVerification(
  http: RuntimeHttp,
  email: string,
  password: string,
  turnstileToken = "",
): Promise<void> {
  await http.request("/auth/resend-verification", undefined, {
    email,
    password,
    turnstile_token: turnstileToken,
  });
}

export async function verifyEmail(http: RuntimeHttp, email: string, code: string): Promise<Session> {
  return session(http, "/auth/verify-email", { email, code });
}

export async function forgotPassword(
  http: RuntimeHttp,
  email: string,
  turnstileToken = "",
): Promise<void> {
  await http.request("/auth/forgot-password", undefined, {
    email,
    turnstile_token: turnstileToken,
  });
}

export async function resetPassword(
  http: RuntimeHttp,
  email: string,
  code: string,
  password: string,
): Promise<Session> {
  return session(http, "/auth/reset-password", { email, code, password });
}

export async function oauthAuthorizeUrl(
  http: RuntimeHttp,
  provider: "github" | "google",
  loopbackUri: string,
): Promise<string> {
  const payload = await http.request(`/auth/oauth/${provider}/authorize-url`, undefined, {
    loopback_uri: loopbackUri,
  });
  if (typeof payload.url !== "string" || !payload.url.trim()) {
    throw new DesktopApiError("OAuth 授权地址无效");
  }
  return payload.url.trim();
}

export async function oauthExchange(http: RuntimeHttp, code: string): Promise<Session> {
  return session(http, "/auth/oauth/exchange", { code });
}

export async function turnstileInfo(http: RuntimeHttp): Promise<TurnstileInfo> {
  const payload = await http.request("/auth/turnstile", undefined, undefined, "GET");
  return {
    siteKey: typeof payload.site_key === "string" ? payload.site_key : "",
    required: payload.required === true,
  };
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
