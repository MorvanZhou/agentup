/** 将未读总数同步到 Electron Dock / 任务栏角标；浏览器环境无桥接则忽略。 */
export function syncAppBadge(count: number): void {
  const bridge = typeof window !== "undefined" ? window.agentUp : undefined;
  if (typeof bridge?.setAppBadge !== "function") return;
  const next = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  void bridge.setAppBadge(next).catch(() => {
    /* 主进程不可用时忽略 */
  });
}
