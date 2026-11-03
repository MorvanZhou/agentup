import { t, tf, type UiLocale } from "../../../../shared/model/ui/ui-locale";

/** 列表旁显示的相对/短日期更新时间；缺时间戳返回空串。 */
export function formatWorkspaceUpdatedAt(mtimeMs: number | undefined, locale: UiLocale, now = Date.now()): string {
  if (typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs) || mtimeMs <= 0) return "";
  const diff = Math.max(0, now - mtimeMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return t("wsUpdatedJustNow");
  if (diff < hour) return tf("wsUpdatedMinutesAgo", { n: Math.floor(diff / minute) });
  if (diff < day) return tf("wsUpdatedHoursAgo", { n: Math.floor(diff / hour) });
  if (diff < 7 * day) return tf("wsUpdatedDaysAgo", { n: Math.floor(diff / day) });
  const tag = locale === "en" ? "en-US" : "zh-CN";
  return new Intl.DateTimeFormat(tag, { year: "numeric", month: "short", day: "numeric" }).format(
    new Date(mtimeMs),
  );
}
