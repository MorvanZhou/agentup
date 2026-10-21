import { BackendClientError } from "./errors.js";
import type { AgentCard, Recruit, SessionCredential, UserPreferences } from "./types.js";

export function credential(payload: Record<string, unknown>): SessionCredential {
  if (
    typeof payload.user_id !== "string" ||
    typeof payload.email !== "string" ||
    typeof payload.nickname !== "string" ||
    typeof payload.token !== "string"
  ) {
    throw new BackendClientError("登录响应无效", 200);
  }
  const hasAvatar = payload.has_avatar === true;
  const avatarUrl =
    typeof payload.avatar_url === "string" && payload.avatar_url.trim()
      ? payload.avatar_url
      : undefined;
  return {
    userId: payload.user_id,
    email: payload.email,
    nickname: payload.nickname,
    token: payload.token,
    hasAvatar,
    ...(hasAvatar && avatarUrl ? { avatarUrl } : {}),
  };
}

export function agentCard(value: unknown): AgentCard {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BackendClientError("Agent 列表无效", 200);
  }
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.agent_id !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.background !== "string" ||
    typeof payload.latest_version !== "number" ||
    typeof payload.latest_digest !== "string" ||
    typeof payload.recruited !== "boolean" ||
    typeof payload.has_avatar !== "boolean"
  ) {
    throw new BackendClientError("Agent 列表无效", 200);
  }
  const avatarUrl =
    typeof payload.avatar_url === "string" && payload.avatar_url.trim()
      ? payload.avatar_url
      : undefined;
  const recruitCount =
    typeof payload.recruit_count === "number" &&
    Number.isInteger(payload.recruit_count) &&
    payload.recruit_count >= 0
      ? payload.recruit_count
      : 0;
  const createdAt = typeof payload.created_at === "string" ? payload.created_at : "";
  const updatedAt = typeof payload.updated_at === "string" ? payload.updated_at : "";
  const remark = typeof payload.remark === "string" ? payload.remark.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  const role = typeof payload.role === "string" ? payload.role.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  const rules = typeof payload.rules === "string" ? payload.rules : "";
  return {
    agentId: payload.agent_id,
    name: payload.name,
    role,
    background: payload.background,
    rules,
    latestVersion: payload.latest_version,
    latestDigest: payload.latest_digest,
    recruited: payload.recruited,
    hasAvatar: payload.has_avatar,
    remark: payload.recruited ? remark : "",
    recruitCount,
    createdAt,
    updatedAt,
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

export function recruit(payload: Record<string, unknown>): Recruit {
  if (
    typeof payload.user_id !== "string" ||
    typeof payload.agent_id !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.latest_version !== "number" ||
    typeof payload.latest_digest !== "string"
  ) {
    throw new BackendClientError("招募响应无效", 200);
  }
  const remark = typeof payload.remark === "string" ? payload.remark.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  const role = typeof payload.role === "string" ? payload.role.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  return {
    userId: payload.user_id,
    agentId: payload.agent_id,
    name: payload.name,
    role,
    latestVersion: payload.latest_version,
    latestDigest: payload.latest_digest,
    remark,
  };
}

export function preferences(payload: Record<string, unknown>): UserPreferences {
  const mode = payload.theme_mode;
  if (mode !== "system" && mode !== "light" && mode !== "dark") {
    throw new BackendClientError("偏好响应无效", 200);
  }
  if (typeof payload.skip_edit_resend_confirm !== "boolean") {
    throw new BackendClientError("偏好响应无效", 200);
  }
  const uiLocale = payload.ui_locale === "en" ? "en" : "zh";
  return { themeMode: mode, skipEditResendConfirm: payload.skip_edit_resend_confirm, uiLocale };
}
