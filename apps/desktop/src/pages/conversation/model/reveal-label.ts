import { t } from "../../../shared/model/ui-locale";

/** 按本机平台给出「在文件管理器中显示」的文案。 */
export function revealInFolderLabel(platform: string): string {
  if (platform === "darwin") return t("revealFinder");
  if (platform === "win32") return t("revealExplorer");
  return t("revealFileManager");
}

/** Electron 优先；浏览器测试用 UA 推断。 */
export function detectDesktopPlatform(): string {
  const fromBridge = window.agentUp?.platform;
  if (fromBridge === "darwin" || fromBridge === "win32" || fromBridge === "linux") return fromBridge;
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad|iPod/i.test(ua)) return "darwin";
  if (/Win/i.test(ua)) return "win32";
  return "linux";
}
