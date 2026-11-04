import { t } from "../../../../../../shared/model/ui/ui-locale";

/** 状态机 → 状态标签词条（见 .cursor/skills/agentup-sdk-adapter/references/overview.md §2） */
const SDK_STATE_KEYS: Record<string, string> = {
  not_installed: "providerSdkStateNotInstalled",
  installing: "providerSdkStateInstalling",
  install_failed: "providerSdkStateInstallFailed",
  installed: "providerSdkStateInstalled",
  not_logged_in: "providerSdkStateNotLoggedIn",
  logging_in: "providerSdkStateLoggingIn",
  ready: "providerSdkStateReady",
  error: "providerSdkStateError",
};

export function sdkStateLabel(state: string): string {
  return t(SDK_STATE_KEYS[state] ?? "providerSdkStateNotInstalled");
}

/** 只有 ready 才算可用；其余状态走「开始接入 / 登录」 */
export const sdkReady = (state: string): boolean => state === "ready";

/** 已接入未登录 → 登录；未接入或接入失败 → 开始接入 */
export const needsLogin = (state: string): boolean =>
  ["installed", "not_logged_in", "error"].includes(state);

export const busyState = (state: string): boolean =>
  ["installing", "logging_in"].includes(state);

/** 已登录（或残留登录态）才谈得上登出；登出只清登录态，接入组件还留着 */
export const canLogout = (state: string): boolean => sdkReady(state) || state === "error";

/** 待接入 / 接入失败：专治「已装桌面版为何仍提示未接入」的误解 */
export const showDesktopMyth = (state: string): boolean =>
  state === "not_installed" || state === "install_failed";

/** 状态徽标配色：可用 / 失败 / 进行中 / 其余中性 */
export function statePillClass(state: string): string {
  if (sdkReady(state)) return "border-transparent bg-success-soft text-success-foreground";
  if (state === "install_failed" || state === "error")
    return "border-destructive/30 bg-danger-soft text-destructive";
  if (busyState(state)) return "border-accent/30 bg-accent/10 text-accent";
  return "border-rule bg-background text-muted-foreground";
}

/** 主钮文案跟状态机走：可用→刷模型；已装未登→登录；其余→开始接入 */
export function sdkPrimaryLabel(state: string): string {
  // 与页顶「刷新全部模型」区分：这里只刷当前本地接入
  if (sdkReady(state)) return t("providerSdkRefreshThis");
  if (needsLogin(state)) return t("providerSdkLogin");
  return t("providerSdkStart");
}

/**
 * 浏览器 OAuth 提示：仅登录中、且不是 Key 粘贴 / 安装进度。
 * 避免「接入中」却显示「已打开浏览器」（安装慢或超时清 phase 后的假提示）。
 */
export function showBrowserOauthHint(
  state: string,
  options: { installPhase: boolean; loginNeedsApiKey: boolean; modelsBusy: boolean },
): boolean {
  if (options.installPhase || options.loginNeedsApiKey || options.modelsBusy) return false;
  return state === "logging_in";
}

/**
 * 取消接入：有进行中安装任务，或状态卡在 installing（超时清 phase / 丢 job）。
 */
export function showCancelInstall(state: string, hasInstallPhase: boolean): boolean {
  return hasInstallPhase || state === "installing";
}
