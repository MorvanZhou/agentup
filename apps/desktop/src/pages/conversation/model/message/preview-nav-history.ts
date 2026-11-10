/** 预览面板自管导航栈：跨域 iframe 读不到 history，用本栈驱动后退/前进可点态。 */

export type PreviewNavHistory = {
  stack: string[];
  index: number;
};

export function createPreviewNavHistory(url: string): PreviewNavHistory {
  const trimmed = url.trim();
  return { stack: [trimmed || "about:blank"], index: 0 };
}

export function previewNavCurrent(history: PreviewNavHistory): string {
  return history.stack[history.index] ?? "about:blank";
}

export function previewNavCanGoBack(history: PreviewNavHistory): boolean {
  return history.index > 0;
}

export function previewNavCanGoForward(history: PreviewNavHistory): boolean {
  return history.index < history.stack.length - 1;
}

/** 新地址：截断前进分支后压入；与当前相同则不变。 */
export function previewNavPush(history: PreviewNavHistory, url: string): PreviewNavHistory {
  const next = url.trim();
  if (!next || next === previewNavCurrent(history)) return history;
  const stack = history.stack.slice(0, history.index + 1);
  stack.push(next);
  return { stack, index: stack.length - 1 };
}

export function previewNavBack(history: PreviewNavHistory): PreviewNavHistory {
  if (!previewNavCanGoBack(history)) return history;
  return { stack: history.stack, index: history.index - 1 };
}

export function previewNavForward(history: PreviewNavHistory): PreviewNavHistory {
  if (!previewNavCanGoForward(history)) return history;
  return { stack: history.stack, index: history.index + 1 };
}

/** 地址栏输入：无 scheme 时补 http://，便于本地预览手输。 */
export function normalizePreviewAddress(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

/**
 * 内嵌 iframe 只吃本机预览；外站常带 X-Frame-Options / frame-ancestors，应降级 openExternal。
 * about:blank 仅供测试与空帧。
 */
export function canEmbedPreviewInIframe(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol === "about:") return parsed.pathname === "blank";
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1"
  );
}
