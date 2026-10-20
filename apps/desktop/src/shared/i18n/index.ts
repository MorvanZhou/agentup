import { createI18n } from "vue-i18n";

import zh from "./locales/zh.json";

export type UiLocale = "zh" | "en";

export const i18n = createI18n({
  legacy: false,
  locale: "zh",
  fallbackLocale: "zh",
  messages: { zh },
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
});

const loaded = new Set<UiLocale>(["zh"]);

export function isUiLocale(value: unknown): value is UiLocale {
  return value === "zh" || value === "en";
}

/** 按需加载语言包；已加载的语言直接切换，扩展新语言不拖累默认包体积。 */
export async function ensureLocaleMessages(locale: UiLocale): Promise<void> {
  if (loaded.has(locale)) return;
  const mod = await import(`./locales/${locale}.json`);
  i18n.global.setLocaleMessage(locale, mod.default);
  loaded.add(locale);
}

export async function setI18nLocale(locale: UiLocale): Promise<void> {
  await ensureLocaleMessages(locale);
  i18n.global.locale.value = locale;
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
  }
}

export function t(key: string, named?: Record<string, unknown>): string {
  return String(named ? i18n.global.t(key, named) : i18n.global.t(key));
}
