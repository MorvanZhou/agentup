/**
 * macOS 通知中心 / Windows 右下角 toast。
 * Windows：任务栏黄闪 + toastXml 按钮（协议激活打开会话）；
 * macOS：点横幅本体即可，系统侧不依赖 toastXml。
 */

function normalizeBannerTarget(value) {
  if (!value || typeof value !== "object") return null;
  const kind = value.kind;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if ((kind !== "agent" && kind !== "group") || !id || id.length > 200) return null;
  return { kind, id };
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** agentup://notice?kind=agent|group&id=… —— Windows toast 按钮与整条点击共用。 */
function noticeDeepLink(target) {
  const next = normalizeBannerTarget(target);
  if (!next) return "";
  return `agentup://notice?kind=${encodeURIComponent(next.kind)}&id=${encodeURIComponent(next.id)}`;
}

/**
 * 从 agentup://notice?… 或命令行里的同类 URL 抽出会话目标。
 * @param {unknown} url
 */
function parseNoticeDeepLink(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "agentup:") return null;
    if (parsed.hostname !== "notice") return null;
    return normalizeBannerTarget({
      kind: parsed.searchParams.get("kind"),
      id: parsed.searchParams.get("id"),
    });
  } catch {
    return null;
  }
}

/**
 * Windows Toast XML：标题 + 正文 +「打开对话」按钮。
 * 整条横幅与按钮都走协议激活，应用在后台或已退出时也能唤起。
 * @param {{ title: string, body: string, actionLabel: string, target: { kind: string, id: string }, icon?: string }} input
 */
function buildWindowsToastXml(input) {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const body = typeof input?.body === "string" ? input.body.trim() : "";
  const actionLabel = typeof input?.actionLabel === "string" ? input.actionLabel.trim() : "";
  const target = normalizeBannerTarget(input?.target);
  if (!title || !target || !actionLabel) return "";
  const launch = noticeDeepLink(target);
  if (!launch) return "";
  const launchXml = escapeXml(launch);
  const icon =
    typeof input?.icon === "string" && input.icon.trim()
      ? `<image placement="appLogoOverride" src="${escapeXml(
          input.icon.startsWith("file:") ? input.icon : `file:///${input.icon.replace(/\\/g, "/")}`,
        )}" hint-crop="circle"/>`
      : "";
  return [
    `<toast activationType="protocol" launch="${launchXml}">`,
    "<visual>",
    '<binding template="ToastGeneric">',
    `<text>${escapeXml(title)}</text>`,
    `<text>${escapeXml(body || title)}</text>`,
    icon,
    "</binding>",
    "</visual>",
    "<actions>",
    `<action content="${escapeXml(actionLabel)}" arguments="${launchXml}" activationType="protocol"/>`,
    "</actions>",
    "</toast>",
  ].join("");
}

/**
 * 未聚焦的窗口在任务栏黄闪；聚焦后停掉。已聚焦的窗口不闪。
 * @param {{
 *   platform?: string,
 *   getWindows?: () => Array<{ isDestroyed?: () => boolean, isFocused?: () => boolean, once?: Function, flashFrame?: (value: boolean) => void }>,
 * }} deps
 */
function flashTaskbarAttention(deps) {
  const platform = deps?.platform ?? process.platform;
  if (platform !== "win32") return 0;
  const windows = typeof deps?.getWindows === "function" ? deps.getWindows() : [];
  let flashed = 0;
  for (const win of windows) {
    if (!win || (typeof win.isDestroyed === "function" && win.isDestroyed())) continue;
    if (typeof win.flashFrame !== "function") continue;
    if (typeof win.isFocused === "function" && win.isFocused()) continue;
    if (typeof win.once === "function") {
      win.once("focus", () => {
        if (typeof win.isDestroyed === "function" && win.isDestroyed()) return;
        win.flashFrame(false);
      });
    }
    win.flashFrame(true);
    flashed += 1;
  }
  return flashed;
}

/**
 * @param {unknown} payload
 * @param {{
 *   platform?: string,
 *   Notification?: new (options: Record<string, unknown>) => {
 *     on?: (event: string, listener: (...args: unknown[]) => void) => void,
 *     show?: () => void,
 *   },
 *   isSupported?: () => boolean,
 *   icon?: string,
 *   onClick?: (target: { kind: "agent" | "group", id: string }) => void,
 *   flashTaskbar?: () => void,
 * }} deps
 */
function showSystemBanner(payload, deps) {
  const title = payload && typeof payload.title === "string" ? payload.title.trim() : "";
  const body = payload && typeof payload.body === "string" ? payload.body.trim() : "";
  const actionLabel =
    payload && typeof payload.actionLabel === "string" ? payload.actionLabel.trim() : "";
  const target = normalizeBannerTarget(payload && payload.target);
  if (!title || !target) return false;
  if (typeof deps?.isSupported === "function" && !deps.isSupported()) return false;
  const NotificationCtor = deps?.Notification;
  if (typeof NotificationCtor !== "function") return false;

  const platform = deps?.platform ?? process.platform;
  /** @type {Record<string, unknown>} */
  const options = { title, body: body || title };
  if (typeof deps.icon === "string" && deps.icon.trim()) options.icon = deps.icon;

  if (platform === "win32" && actionLabel) {
    const toastXml = buildWindowsToastXml({
      title,
      body: body || title,
      actionLabel,
      target,
      icon: typeof deps.icon === "string" ? deps.icon : "",
    });
    if (toastXml) options.toastXml = toastXml;
  } else if (actionLabel) {
    // macOS / Linux：有签名或桌面支持时才看得见按钮；点横幅本体仍走 click。
    options.actions = [{ type: "button", text: actionLabel }];
  }

  const notification = new NotificationCtor(options);
  if (typeof notification.on === "function" && typeof deps.onClick === "function") {
    notification.on("click", () => deps.onClick(target));
    notification.on("action", () => deps.onClick(target));
  }
  if (typeof deps.flashTaskbar === "function") deps.flashTaskbar();
  if (typeof notification.show === "function") notification.show();
  return true;
}

module.exports = {
  buildWindowsToastXml,
  flashTaskbarAttention,
  normalizeBannerTarget,
  noticeDeepLink,
  parseNoticeDeepLink,
  showSystemBanner,
};
