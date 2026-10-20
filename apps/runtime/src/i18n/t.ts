import { DEFAULT_LOCALE, normalizeLocale, type UiLocale } from "./locale.js";
import { en } from "./locales/en.js";
import { zh } from "./locales/zh.js";

const CATALOGS: Record<UiLocale, Record<string, string>> = { zh, en };

/** 取词条；缺 key 回落 zh，再回落 key 本身。`{name}` 插值。 */
export function t(
  key: string,
  locale: UiLocale | string | null | undefined = DEFAULT_LOCALE,
  vars?: Record<string, string | number>,
): string {
  const resolved = normalizeLocale(typeof locale === "string" ? locale : undefined);
  const template = CATALOGS[resolved][key] || CATALOGS[DEFAULT_LOCALE][key] || key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : `{${name}}`,
  );
}
