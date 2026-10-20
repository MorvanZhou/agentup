/** 与 Desktop / Backend 对齐的语言码；缺省中文。 */
export type UiLocale = "zh" | "en";

export const DEFAULT_LOCALE: UiLocale = "zh";
export const SUPPORTED_LOCALES = ["zh", "en"] as const;

export function normalizeLocale(value: string | null | undefined): UiLocale {
  if (!value) return DEFAULT_LOCALE;
  const primary = value.trim().toLowerCase().replace(/_/g, "-").split(",")[0]?.split("-")[0];
  return primary === "en" ? "en" : "zh";
}

/** 合并 query `lang` 与 header `x-ui-locale`（query 优先）。 */
export function localeFromRequest(
  lang: string | null | undefined,
  header: string | null | undefined,
): UiLocale {
  return normalizeLocale(lang || header);
}
