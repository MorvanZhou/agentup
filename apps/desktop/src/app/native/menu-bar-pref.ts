/** 本机是否在 macOS 菜单栏显示图标与未读提示；缺省开启。 */
const KEY = "agentup.menuBarVisible";

export function readMenuBarVisible(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

export function writeMenuBarVisible(visible: boolean): void {
  try {
    localStorage.setItem(KEY, visible ? "1" : "0");
  } catch {
    /* 隐私模式等写失败时忽略 */
  }
}

/** 仅 macOS Electron 有状态栏图标；浏览器 / 其他平台不展示该设置。 */
export function isMenuBarPrefAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return window.agentUp?.platform === "darwin";
}

/** 将显隐同步到主进程；非 Electron 或桥接缺失时忽略。 */
export function syncMenuBarVisible(visible: boolean): void {
  const bridge = typeof window !== "undefined" ? window.agentUp : undefined;
  if (typeof bridge?.setMenuBarVisible !== "function") return;
  void bridge.setMenuBarVisible(visible).catch(() => {
    /* 主进程不可用时忽略 */
  });
}
