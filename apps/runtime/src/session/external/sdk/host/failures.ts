import { t } from "../../../../i18n/index.js";
import type { UiLocale } from "../../../../i18n/locale.js";

/**
 * 本地 Agent App 的失败分类与文案。
 * 复用不了供应商 API Key 那套：本地 App 的下一步动作不同。
 */

export type AgentSdkFailureCode =
  | "not_installed"
  | "not_logged_in"
  | "model_unavailable"
  | "quota"
  | "rate_limited"
  | "timeout"
  | "incompatible"
  | "unknown";

const CODES: readonly string[] = [
  "not_installed",
  "not_logged_in",
  "model_unavailable",
  "quota",
  "rate_limited",
  "timeout",
  "incompatible",
  "unknown",
];

const MARKER = /^\[agent-sdk:([a-z_]+)\]\s*([\s\S]*)$/;
const DETAIL_LIMIT = 120;

const STATE_CODES: Record<string, AgentSdkFailureCode> = {
  not_installed: "not_installed",
  installing: "not_installed",
  install_failed: "not_installed",
  installed: "not_logged_in",
  not_logged_in: "not_logged_in",
  logging_in: "not_logged_in",
  error: "not_logged_in",
};

export function markAgentSdkFailure(code: AgentSdkFailureCode, detail = ""): string {
  return `[agent-sdk:${code}] ${scrubSecrets(detail).trim()}`.trimEnd();
}

export function isAgentSdkFailure(text: string): boolean {
  return MARKER.test(text.trim());
}

export function agentSdkFailureNotice(
  text: string,
  locale?: UiLocale | string | null,
): string | null {
  const matched = MARKER.exec(text.trim());
  if (!matched) return null;
  const code = (CODES.includes(matched[1] ?? "") ? matched[1] : "unknown") as AgentSdkFailureCode;
  const detail = truncate(scrubSecrets(matched[2] ?? "").trim(), DETAIL_LIMIT);
  return t(`agentSdk.fail.${code}`, locale, { detail: detail || unknownDetail(locale) });
}

function unknownDetail(locale?: UiLocale | string | null): string {
  return t("agentSdk.fail.noDetail", locale);
}

export function classifyAgentSdkFailure(raw: string, state?: string | null): AgentSdkFailureCode {
  if (state && state !== "ready") {
    const byState = STATE_CODES[state];
    if (byState) return byState;
  }
  const text = (raw ?? "").trim();
  if (!text) return "unknown";
  // 产品面说「接入」；旧错误仍可能带「安装」，两边都认
  if (/尚未接入|未接入|尚未安装|未安装|not connected|not installed|ENOENT/i.test(text)) {
    return "not_installed";
  }
  if (
    /不支持\s*query|缺少\s*query|is not a function|incompatible|custom system prompt is not enabled|system prompt is not enabled/i.test(
      text,
    )
  ) {
    return "incompatible";
  }
  if (isQuotaText(text)) return "quota";
  if (isRateLimitText(text)) return "rate_limited";
  if (/only available for authorized|not available for|无权限|没有权限|无访问权限/i.test(text)) {
    return "model_unavailable";
  }
  if (/登录|login|auth|unauthorized|401/i.test(text)) return "not_logged_in";
  if (/timed?\s*out|timeout|超时/i.test(text)) return "timeout";
  return "unknown";
}

function isQuotaText(text: string): boolean {
  return (
    /额度|quota|insufficient|billing|payment|402|无可用\s*Token/i.test(text) ||
    (/429/.test(text) && /额度|quota|token/i.test(text))
  );
}

function isRateLimitText(text: string): boolean {
  return /429|rate limit|too many requests|频繁|限流|overload/i.test(text);
}

export function scrubSecrets(text: string): string {
  let out = text ?? "";
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, "Bearer ***");
  out = out.replace(/\bsk-[A-Za-z0-9._-]{6,}/gi, "***");
  out = out.replace(/([?&](?:token|access_token|api_key|apikey|key|secret)=)[^&\s]+/gi, "$1***");
  out = out.replace(
    /\b(token|access_token|api_key|apikey|secret|password)\b\s*[:=]\s*["']?[A-Za-z0-9._-]{6,}["']?/gi,
    "$1=***",
  );
  return out;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
