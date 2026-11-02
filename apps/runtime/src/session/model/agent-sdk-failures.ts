import { t } from "../../i18n/index.js";
import type { UiLocale } from "../../i18n/locale.js";

/**
 * 本地 Agent App 的失败分类与文案（阶段 3 加固）。
 *
 * 复用不了 `unavailable.ts` 那套供应商文案：本地 App 没有 API Key、没有控制台余额，
 * 「检查 API Key / 切换模型」这类建议是错的。所以这里单独一套，每条都带**下一步动作**。
 *
 * 走通方式：驱动把 `errorMessage` 写成带标记的文本（`[agent-sdk:<code>] detail`），
 * `unavailable.ts` 见到标记就转交这里，展示前把标记去掉——标记不进会话历史与界面。
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

/** 状态 → 原因码：状态说明一切时不必去看错误文本。 */
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

/** 带标记的错误文本 → 用户文案（去标记 + i18n）。不是本类错误返回 null。 */
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

/** 从原始错误文本（必要时叠加本机状态）推断原因码。 */
export function classifyAgentSdkFailure(raw: string, state?: string | null): AgentSdkFailureCode {
  if (state && state !== "ready") {
    const byState = STATE_CODES[state];
    if (byState) return byState;
  }
  const text = (raw ?? "").trim();
  if (!text) return "unknown";
  if (/尚未安装|未安装|not installed|ENOENT/i.test(text)) return "not_installed";
  if (/不支持\s*query|缺少\s*query|is not a function|incompatible/i.test(text)) {
    return "incompatible";
  }
  if (isQuotaText(text)) return "quota";
  if (isRateLimitText(text)) return "rate_limited";
  // 目录里查得到、但当前账号用不了：换模型，重新登录也没用
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

/**
 * 抹掉可能混进错误文本里的凭据。
 * 这些文本会进会话历史（落盘）和日志，token / 带参链接一律不让过。
 */
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
