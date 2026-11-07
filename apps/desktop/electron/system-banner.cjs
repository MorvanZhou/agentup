/**
 * macOS 通知中心 / Windows 右下角 toast。
 * 只接受 agent / group 目标，点击后由主进程把窗口拉到前台并交给渲染进程打开会话。
 */

function normalizeBannerTarget(value) {
  if (!value || typeof value !== "object") return null;
  const kind = value.kind;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if ((kind !== "agent" && kind !== "group") || !id || id.length > 200) return null;
  return { kind, id };
}

/**
 * @param {unknown} payload
 * @param {{
 *   Notification?: new (options: { title: string, body: string, icon?: string }) => {
 *     on?: (event: string, listener: () => void) => void,
 *     show?: () => void,
 *   },
 *   isSupported?: () => boolean,
 *   icon?: string,
 *   onClick?: (target: { kind: "agent" | "group", id: string }) => void,
 * }} deps
 */
function showSystemBanner(payload, deps) {
  const title = payload && typeof payload.title === "string" ? payload.title.trim() : "";
  const body = payload && typeof payload.body === "string" ? payload.body.trim() : "";
  const target = normalizeBannerTarget(payload && payload.target);
  if (!title || !target) return false;
  if (typeof deps?.isSupported === "function" && !deps.isSupported()) return false;
  const NotificationCtor = deps?.Notification;
  if (typeof NotificationCtor !== "function") return false;
  const options = { title, body: body || title };
  if (typeof deps.icon === "string" && deps.icon.trim()) options.icon = deps.icon;
  const notification = new NotificationCtor(options);
  if (typeof notification.on === "function" && typeof deps.onClick === "function") {
    notification.on("click", () => deps.onClick(target));
  }
  if (typeof notification.show === "function") notification.show();
  return true;
}

module.exports = { normalizeBannerTarget, showSystemBanner };
