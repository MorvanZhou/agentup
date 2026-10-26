import { computed, ref } from "vue";

import { i18n, isUiLocale, setI18nLocale, t as i18nT, type UiLocale } from "../../i18n";

export type { UiLocale };

const DEVICE_KEY = "agentup.locale";

/** 与 i18n.locale 同步的镜像，便于模板里判断当前语言。 */
export const uiLocale = ref<UiLocale>(readDeviceLocale());

export function readDeviceLocale(): UiLocale {
  try {
    return localStorage.getItem(DEVICE_KEY) === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

export function writeDeviceLocale(locale: UiLocale): void {
  try {
    localStorage.setItem(DEVICE_KEY, locale);
  } catch {
    /* 无存储时只保留本次内存选择 */
  }
}

/** 打开 Web 登录页时选用路径前缀（zh → /zh/login，en → /login）。 */
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
