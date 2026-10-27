/** 将待处理件数同步到 Electron Dock / 任务栏角标；浏览器环境无桥接则忽略。 */
export function syncAppBadge(count: number): void {
  const bridge = typeof window !== "undefined" ? window.agentUp : undefined;
  if (typeof bridge?.setAppBadge !== "function") return;
  const next = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  void bridge.setAppBadge(next).catch(() => {
    /* 主进程不可用时忽略 */
  });
}

/** 将待审批与未读的合计同步到 macOS 菜单栏图标右侧；浏览器环境无桥接则忽略。 */
export function syncMenuBarUnread(count: number): void {
  const bridge = typeof window !== "undefined" ? window.agentUp : undefined;
  if (typeof bridge?.setMenuBarUnread !== "function") return;
  const next = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  void bridge.setMenuBarUnread(next).catch(() => {
    /* 主进程不可用时忽略 */
  });
}
