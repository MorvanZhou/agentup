import { t } from "../../i18n/index.js";
import type { UiLocale } from "../../i18n/locale.js";

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
