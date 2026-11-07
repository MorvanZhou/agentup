import { isWebp, putCosObject, type ObjectCredential } from "./cos-put.js";
import { requestJson } from "./http.js";
import { credential } from "./parse.js";
import { BackendClientError } from "./errors.js";
import type { RegisterPending, SessionCredential } from "./types.js";

export async function login(
  backendUrl: string,
  email: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionCredential> {
  const payload = await requestJson(fetchImpl, backendUrl, "POST", "/v1/login", {
    email,
    password,
  });
  return credential(payload);
}

export async function registerAccount(
  backendUrl: string,
  email: string,
  password: string,
  turnstileToken = "",
  fetchImpl: typeof fetch = fetch,
): Promise<RegisterPending> {
  const payload = await requestJson(fetchImpl, backendUrl, "POST", "/v1/register", {
    email,
    password,
    turnstile_token: turnstileToken,
  });
  if (typeof payload.email !== "string" || payload.status !== "pending_verification") {
    throw new BackendClientError("注册响应无效", 200);
  }
  return { email: payload.email, status: "pending_verification" };
}

export async function resendVerification(
  backendUrl: string,
  email: string,
  password: string,
  turnstileToken = "",
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await requestJson(fetchImpl, backendUrl, "POST", "/v1/auth/resend-verification", {
    email,
    password,
    turnstile_token: turnstileToken,
  });
}

export async function verifyEmail(
  backendUrl: string,
  email: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionCredential> {
  const payload = await requestJson(fetchImpl, backendUrl, "POST", "/v1/auth/verify-email", {
    email,
    code,
  });
  return credential(payload);
}

export async function forgotPassword(
  backendUrl: string,
  email: string,
  turnstileToken = "",
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await requestJson(fetchImpl, backendUrl, "POST", "/v1/auth/forgot-password", {
    email,
    turnstile_token: turnstileToken,
  });
}

export async function resetPassword(
  backendUrl: string,
  email: string,
  code: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionCredential> {
  const payload = await requestJson(fetchImpl, backendUrl, "POST", "/v1/auth/reset-password", {
    email,
    code,
    password,
  });
  return credential(payload);
}

export async function oauthAuthorizeUrl(
  backendUrl: string,
  provider: "github" | "google",
  loopbackUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = new URL(`${backendUrl.replace(/\/$/, "")}/v1/auth/oauth/${provider}/start`);
  url.searchParams.set("loopback_uri", loopbackUri);
  void fetchImpl;
  return url.toString();
}

export async function oauthExchange(
  backendUrl: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionCredential> {
  const payload = await requestJson(fetchImpl, backendUrl, "POST", "/v1/auth/oauth/exchange", {
    code,
  });
  return credential(payload);
}

export async function turnstilePublic(
  backendUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ siteKey: string; required: boolean }> {
  const payload = await requestJson(fetchImpl, backendUrl, "GET", "/v1/auth/turnstile");
  return {
    siteKey: typeof payload.site_key === "string" ? payload.site_key : "",
    required: payload.required === true,
  };
}

/** 续签会话（含短期头像 GET）；Desktop 冷启动用来刷新本机头像缓存。 */
export async function fetchProfile(
  backendUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionCredential> {
  const payload = await requestJson(fetchImpl, backendUrl, "GET", "/v1/me", undefined, token);
  return credential(payload);
}

export async function updateProfile(
  backendUrl: string,
  token: string,
  nickname: string,
  options: { avatarBase64?: string } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<SessionCredential> {
  const payload = await requestJson(fetchImpl, backendUrl, "PUT", "/v1/me", { nickname }, token);
  if (!options.avatarBase64) return credential(payload);
  const bytes = Buffer.from(options.avatarBase64, "base64");
  if (!isWebp(bytes)) throw new BackendClientError("头像必须是 webp", 400);
  const grant = await requestJson(fetchImpl, backendUrl, "POST", "/v1/me/avatar-upload", undefined, token);
  const credentialGrant = readProfileCredential(grant);
  await putCosObject({ ...credentialGrant, content_type: "image/webp" }, bytes, fetchImpl);
  const rev = /\/(\d+)\.webp$/.exec(credentialGrant.key)?.[1];
  if (!rev) throw new BackendClientError("上传凭证无效", 502);
  const confirmed = await requestJson(
    fetchImpl,
    backendUrl,
    "POST",
    `/v1/me/avatar-uploaded?rev=${rev}`,
    undefined,
    token,
  );
  return credential(confirmed);
}

function readProfileCredential(value: Record<string, unknown>): ObjectCredential {
  const bucket = value.bucket;
  const region = value.region;
  const key = value.key;
  const secretId = value.tmp_secret_id;
  const secretKey = value.tmp_secret_key;
  const session = value.session_token;
  if (
    typeof bucket !== "string"
    || typeof region !== "string"
    || typeof key !== "string"
    || typeof secretId !== "string"
    || typeof secretKey !== "string"
    || typeof session !== "string"
  ) {
    throw new BackendClientError("上传凭证无效", 502);
  }
  return {
    bucket,
    region,
    key,
    tmp_secret_id: secretId,
    tmp_secret_key: secretKey,
    session_token: session,
    content_type: "image/webp",
    ...(typeof value.host === "string" && value.host.trim() ? { host: value.host.trim() } : {}),
  };
}
