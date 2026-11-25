import { computed, ref } from "vue";

import { i18n, isUiLocale, setI18nLocale, t as i18nT, type UiLocale } from "../../i18n";

export type { UiLocale };

const DEVICE_KEY = "agentup.locale";

/** 系统语言标签 → 界面语言：任一 zh* 为中文，其余（含空）为英文。 */
export function localeFromSystemLanguages(languages: readonly string[]): UiLocale {
  for (const raw of languages) {
    const tag = raw.trim().toLowerCase().replace(/_/g, "-");
    if (!tag) continue;
    const primary = tag.split("-")[0];
    if (primary === "zh") return "zh";
  }
  return "en";
}

function readSystemLanguages(): string[] {
  if (typeof navigator === "undefined") return [];
  const listed = navigator.languages;
  if (Array.isArray(listed) && listed.length > 0) {
    return listed.filter((item): item is string => typeof item === "string");
  }
  if (typeof navigator.language === "string" && navigator.language.trim()) {
    return [navigator.language];
  }
  return [];
}

/** 与 i18n.locale 同步的镜像，便于模板里判断当前语言。 */
export const uiLocale = ref<UiLocale>(readDeviceLocale());

/**
 * 本机界面语言。
 * 已有 `agentup.locale`（升级 / 重装且 userData 未清）→ 沿用；
 * 否则按系统语言探测一次并写入（清应用数据等同首次安装）。
 */
export function readDeviceLocale(): UiLocale {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (raw === "en" || raw === "zh") return raw;
    const detected = localeFromSystemLanguages(readSystemLanguages());
    localStorage.setItem(DEVICE_KEY, detected);
    return detected;
  } catch {
    return localeFromSystemLanguages(readSystemLanguages());
  }
}

export function writeDeviceLocale(locale: UiLocale): void {
  try {
    localStorage.setItem(DEVICE_KEY, locale);
  } catch {
    /* 无存储时只保留本次内存选择 */
  }
}

/**
 * 仅「登录换票成功」时调用一次（establishAccount → refresh）。
 * 补齐「账号仍是出厂 zh、本机已是 en」（英文系统首次安装后 OAuth），避免登录被拽回中文。
 * 禁止在每次 syncPreferences / 改语言后的 refresh 里调用：否则本机 en 时用户显式选中文会被立刻写回 en。
 */
export function resolveAccountLocaleOnLogin(
  device: UiLocale,
  account: UiLocale,
): { locale: UiLocale; pushToAccount: boolean } {
  if (account === "zh" && device === "en") {
    return { locale: "en", pushToAccount: true };
  }
  return { locale: account, pushToAccount: false };
}

/**
 * 拉账号偏好时是否做「出厂 zh → 本机 en」补写。
 * 日常 refresh / 设置里改语言后的 refresh：只信账号 ui_locale，不再按本机覆盖。
 */
export function resolveAccountLocaleForSync(
  device: UiLocale,
  account: UiLocale,
  alignOnLogin: boolean,
): { locale: UiLocale; pushToAccount: boolean } {
  if (!alignOnLogin) return { locale: account, pushToAccount: false };
  return resolveAccountLocaleOnLogin(device, account);
}

/** 打开 Web 登录页时选用路径前缀（zh → /zh/auth/login，en → /auth/login）。 */
export function readUiLocale(): UiLocale {
  const current = i18n.global.locale.value;
  return isUiLocale(current) ? current : uiLocale.value;
}

/** 未登录用本机语言；已登录且拿到账号偏好时用账号语言。 */
export function resolveUiLocale(guest: boolean, device: UiLocale, account?: UiLocale | null): UiLocale {
  if (!guest && isUiLocale(account)) return account;
  return device;
}

/** 切换界面语言（懒加载对应 JSON）。 */
export async function applyUiLocale(locale: UiLocale): Promise<void> {
  await setI18nLocale(locale);
  uiLocale.value = locale;
}

/** 组件与非 setup 代码统一走 vue-i18n；读取 uiLocale 以便 computed / 模板随语言切换。 */
export function t(key: string, named?: Record<string, unknown>): string {
  void uiLocale.value;
  return i18nT(key, named);
}

/** 命名插值：词条用 `{name}`，调用 `tf('key', { name })`。 */
export function tf(key: string, vars: Record<string, string | number>): string {
  void uiLocale.value;
  return i18nT(key, vars);
}

export const localeCode = computed(() => uiLocale.value);
