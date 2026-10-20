/**
 * 应用未读角标到系统图标。
 * macOS：Dock 文字角标（与导航一致，>9 为 9+）；
 * Windows：任务栏数字（setBadgeCount，显示实际总数）。
 */
function applyAppBadge(count, deps) {
  const platform = deps?.platform ?? process.platform;
  const n = normalizeCount(count);
  const label = n <= 0 ? "" : n > 9 ? "9+" : String(n);

  if (platform === "darwin") {
    if (deps?.dock && typeof deps.dock.setBadge === "function") {
      deps.dock.setBadge(label);
    }
  } else if (platform === "win32") {
    if (typeof deps?.setBadgeCount === "function") {
      deps.setBadgeCount(n);
    }
  } else if (typeof deps?.setBadgeCount === "function") {
    deps.setBadgeCount(n);
  }

  return { count: n, label };
}

function normalizeCount(count) {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return 0;
  return Math.min(Math.floor(count), 9999);
}

module.exports = { applyAppBadge, normalizeCount };
