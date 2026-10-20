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

export async function updateProfile(
  backendUrl: string,
  token: string,
  nickname: string,
  options: { avatarBase64?: string } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<SessionCredential> {
  const body: Record<string, string> = { nickname };
  if (options.avatarBase64) body.avatar = options.avatarBase64;
  const payload = await requestJson(fetchImpl, backendUrl, "PUT", "/v1/me", body, token);
  return credential(payload);
}
