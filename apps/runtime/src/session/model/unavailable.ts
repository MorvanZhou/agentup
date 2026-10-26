import { t } from "../../i18n/index.js";
import { normalizeLocale, type UiLocale } from "../../i18n/locale.js";

/** 是否像「模型服务连不上 / 不可用」，而非用户取消或普通业务错误。 */
export function isModelServiceUnavailable(error: string): boolean {
  const text = error.trim();
  if (!text) return false;
  if (isUserCancelError(text)) return false;
  const lower = text.toLowerCase();
  return (
    /connection error/i.test(text) ||
    /econnrefused/i.test(lower) ||
    /enotfound/i.test(lower) ||
    /fetch failed/i.test(lower) ||
    /network\s*error/i.test(lower) ||
    /socket hang up/i.test(lower) ||
    /und_err_connect/i.test(lower) ||
    /connect\s*timeout/i.test(lower) ||
    /timed?\s*out/i.test(lower) ||
    /\b503\b|\b502\b|\b504\b/.test(text) ||
    /service unavailable/i.test(lower) ||
    /model .+ not found/i.test(lower) ||
    /no such model/i.test(lower) ||
    (/ollama/i.test(lower) && /not running|refused|unreachable/i.test(lower)) ||
    /连接/.test(text) ||
    /不可用/.test(text) ||
    /无法连接/.test(text)
  );
}

/** 供应商限流 / 过载（如 ZAI 429 code 1302/1305）。 */
export function isRateLimitError(error: string): boolean {
  const text = error.trim();
  if (!text) return false;
  if (isUserCancelError(text)) return false;
  if (isQuotaOrBillingError(text)) return false;
  const lower = text.toLowerCase();
  return (
    /\b429\b/.test(text) ||
    /rate limit/i.test(lower) ||
    /too many requests/i.test(lower) ||
    /temporarily overloaded/i.test(lower) ||
    /resource.?exhausted/i.test(lower) ||
    /请求过于频繁/.test(text) ||
    /频率限制/.test(text) ||
    /限流/.test(text)
  );
}

/**
 * 额度 / 计费类失败（如 TokenHub 402 免费额度耗尽、OpenAI insufficient_quota）。
 * 优先于笼统 429 resource_exhausted，避免当成「稍后再试」。
 */
export function isQuotaOrBillingError(error: string): boolean {
  const text = error.trim();
  if (!text) return false;
  if (isUserCancelError(text)) return false;
  const lower = text.toLowerCase();
  const parsed = parseProviderPayload(text);
  const code = String(parsed?.code ?? "");
  const hay = `${text}\n${parsed?.message ?? ""}\n${parsed?.message_zh ?? ""}`.toLowerCase();
  return (
    /\b402\b/.test(text) ||
    code === "401008" ||
    /insufficient[_ ]?quota/i.test(hay) ||
    /quota.?exhausted/i.test(hay) ||
    /free trial quota/i.test(hay) ||
    /billing.?not.?enabled/i.test(hay) ||
    /postpaid/i.test(hay) ||
    /payment.?required/i.test(hay) ||
    /exceeded.+quota/i.test(hay) ||
    /余额不足/.test(text) ||
    /额度(已)?(耗尽|用完|不足)/.test(text) ||
    /未开启后付费/.test(text) ||
    /免费体验额度/.test(text) ||
    (parsed?.type === "permission_error" && /quota|billing|postpaid|trial/i.test(hay))
  );
}

/** API Key / 鉴权失败（401、invalid_api_key 等）。 */
export function isAuthError(error: string): boolean {
  const text = error.trim();
  if (!text) return false;
  if (isUserCancelError(text) || isQuotaOrBillingError(text)) return false;
  const lower = text.toLowerCase();
  const parsed = parseProviderPayload(text);
  const hay = `${text}\n${parsed?.message ?? ""}\n${parsed?.message_zh ?? ""}`.toLowerCase();
  return (
    /\b401\b/.test(text) ||
    /invalid[_ ]?api[_ ]?key/i.test(hay) ||
    /incorrect api key/i.test(hay) ||
    /authentication/i.test(hay) ||
    /unauthorized/i.test(hay) ||
    /鉴权失败/.test(text) ||
    /密钥(无效|错误|过期)/.test(text) ||
    /api\s*key/.test(lower)
  );
}

export function isUserCancelError(error: string): boolean {
  const text = error.trim();
  if (!text) return false;
  return (
    /abort/i.test(text) ||
    /cancelled/i.test(text) ||
    /canceled/i.test(text) ||
    /interrupted/i.test(text) ||
    /用户已取消/.test(text) ||
    /已取消/.test(text) ||
    /已终止/.test(text)
  );
}

/** 写入助手气泡与 toast 的提示文案。 */
export function modelUnavailableNotice(locale?: UiLocale | string | null): string {
  return t("chat.modelUnavailable", locale);
}

export function rateLimitNotice(locale?: UiLocale | string | null): string {
  return t("chat.rateLimited", locale);
}

export function quotaExhaustedNotice(locale?: UiLocale | string | null): string {
  return t("chat.quotaExhausted", locale);
}

export function authFailedNotice(locale?: UiLocale | string | null): string {
  return t("chat.authFailed", locale);
}

export function turnCancelledNotice(locale?: UiLocale | string | null): string {
  return t("chat.turnCancelled", locale);
}

/**
 * 空 assistant（Pi 只留 errorMessage）应展示的可读原因。
 * @param options.includeCancel 历史投影为 true（否则空气泡）；流式收尾为 false，交给桌面 cancelled 态。
 */
export function assistantFailureNotice(
  error: string,
  locale?: UiLocale | string | null,
  options: { includeCancel?: boolean } = {},
): string | null {
  const text = error.trim();
  if (!text) return null;
  if (isUserCancelError(text)) {
    return options.includeCancel ? turnCancelledNotice(locale) : null;
  }
  if (isModelServiceUnavailable(text)) return modelUnavailableNotice(locale);
  if (isQuotaOrBillingError(text)) return quotaExhaustedNotice(locale);
  if (isRateLimitError(text)) return rateLimitNotice(locale);
  if (isAuthError(text)) return authFailedNotice(locale);
  return formatProviderFailure(text, locale);
}

type ProviderPayload = {
  message?: string;
  message_zh?: string;
  code?: string | number;
  type?: string;
};

function parseProviderPayload(text: string): ProviderPayload | undefined {
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) return undefined;
  try {
    return JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as ProviderPayload;
  } catch {
    return undefined;
  }
}

/** 抽出供应商可读细节；zh 优先 message_zh。 */
export function extractProviderDetail(
  text: string,
  locale?: UiLocale | string | null,
): string {
  const parsed = parseProviderPayload(text);
  const preferZh = normalizeLocale(locale) === "zh";
  if (parsed) {
    const zh =
      typeof parsed.message_zh === "string" ? parsed.message_zh.trim() : "";
    const en = typeof parsed.message === "string" ? parsed.message.trim() : "";
    const picked = preferZh ? zh || en : en || zh;
    if (picked) return picked.length > 200 ? `${picked.slice(0, 199)}…` : picked;
  }
  const trimmed = text.trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 199)}…` : trimmed;
}

/** 未知供应商错误：附排查引导，避免只甩原始英文。 */
function formatProviderFailure(
  text: string,
  locale?: UiLocale | string | null,
): string {
  const detail = extractProviderDetail(text, locale);
  return t("chat.providerCallFailed", locale, { detail });
}
