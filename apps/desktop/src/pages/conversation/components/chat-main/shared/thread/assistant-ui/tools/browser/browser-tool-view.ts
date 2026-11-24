import { parseMcpToolName, shortPath } from "../shared/tool-args";

/** 截图上叠点击准星：相对图片宽高的 0–1 比例。 */
export type BrowserClickMarker = { x: number; y: number };

/** Playwright / Browser Use MCP / 裸名 `browser_*`（含大小写变体）。 */
export function resolveBrowserToolName(toolName: string): string | null {
  const mcp = parseMcpToolName(toolName);
  // mcp__playwright__* 与 mcp__browser__* 都剥成 browser_*
  const bare = (mcp?.tool ?? toolName).trim();
  if (!bare) return null;
  const lower = bare.toLowerCase();
  if (!lower.startsWith("browser_")) return null;
  return lower;
}

function finiteRatio(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/**
 * 从工具 args / result 抽出点击位置，供气泡截图叠准星。
 * 优先归一化比例；否则用像素 + 可选 viewport 估比例；估不出则 null。
 */
export function browserClickMarker(args: unknown, result?: unknown): BrowserClickMarker | null {
  const fromArgs = markerFromRecord(args);
  if (fromArgs) return fromArgs;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const record = result as Record<string, unknown>;
    const nested =
      markerFromRecord(record) ||
      markerFromRecord(record.metadata) ||
      markerFromRecord(record.details) ||
      markerFromRecord(record.click);
    if (nested) return nested;
    const text = typeof record.text === "string" ? record.text : "";
    const fromText = markerFromResultText(text);
    if (fromText) return fromText;
  }
  return null;
}

function markerFromRecord(value: unknown): BrowserClickMarker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const rx = finiteRatio(record.xRatio ?? record.x_ratio);
  const ry = finiteRatio(record.yRatio ?? record.y_ratio);
  if (rx != null && ry != null) return { x: rx, y: ry };

  const coordinate = record.coordinate ?? record.position;
  if (Array.isArray(coordinate) && coordinate.length >= 2) {
    return markerFromPixels(
      finiteNumber(coordinate[0]),
      finiteNumber(coordinate[1]),
      record,
    );
  }

  const box = record.box ?? record.boundingBox ?? record.bounding_box;
  if (box && typeof box === "object" && !Array.isArray(box)) {
    const b = box as Record<string, unknown>;
    const x = finiteNumber(b.x);
    const y = finiteNumber(b.y);
    const w = finiteNumber(b.width) ?? 0;
    const h = finiteNumber(b.height) ?? 0;
    if (x != null && y != null) {
      return markerFromPixels(x + w / 2, y + h / 2, { ...record, ...b });
    }
  }

  return markerFromPixels(finiteNumber(record.x), finiteNumber(record.y), record);
}

function markerFromPixels(
  x: number | null,
  y: number | null,
  sizeSource: Record<string, unknown>,
): BrowserClickMarker | null {
  if (x == null || y == null) return null;
  const width =
    finiteNumber(sizeSource.viewportWidth) ??
    finiteNumber(sizeSource.viewport_width) ??
    finiteNumber(sizeSource.pageWidth) ??
    finiteNumber(sizeSource.width);
  const height =
    finiteNumber(sizeSource.viewportHeight) ??
    finiteNumber(sizeSource.viewport_height) ??
    finiteNumber(sizeSource.pageHeight) ??
    finiteNumber(sizeSource.height);
  // 无视口时：若坐标像比例则直接用；否则无法可靠叠层
  if (width == null || height == null || width <= 0 || height <= 0) {
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) return { x, y };
    return null;
  }
  return {
    x: Math.min(1, Math.max(0, x / width)),
    y: Math.min(1, Math.max(0, y / height)),
  };
}

/** 从 result 文本里抠 `(x, y)` / `x=… y=…`。 */
function markerFromResultText(text: string): BrowserClickMarker | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const pair = trimmed.match(/\((\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\)/);
  if (pair) {
    return markerFromPixels(Number(pair[1]), Number(pair[2]), {});
  }
  const named = trimmed.match(/\bx\s*[=:]\s*(\d+(?:\.\d+)?).{0,24}?\by\s*[=:]\s*(\d+(?:\.\d+)?)/i);
  if (named) {
    return markerFromPixels(Number(named[1]), Number(named[2]), {});
  }
  return null;
}

function argText(args: unknown, key: string): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const value = (args as Record<string, unknown>)[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function clip(text: string, max = 48): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/** 摘要行标题：Navigate / Click / … */
export function browserToolTitle(name: string): string {
  const map: Record<string, string> = {
    browser_navigate: "Navigate",
    browser_navigate_back: "Back",
    browser_click: "Click",
    browser_type: "Type",
    browser_fill: "Fill",
    browser_fill_form: "Fill form",
    browser_snapshot: "Snapshot",
    browser_take_screenshot: "Screenshot",
    browser_tabs: "Tabs",
    browser_wait_for: "Wait",
    browser_press_key: "Press key",
    browser_select_option: "Select",
    browser_hover: "Hover",
    browser_drag: "Drag",
    browser_scroll: "Scroll",
    browser_close: "Close",
    browser_resize: "Resize",
    browser_console_messages: "Console",
    browser_network_requests: "Network",
    browser_evaluate: "Evaluate",
    browser_handle_dialog: "Dialog",
    browser_file_upload: "Upload",
    browser_lock: "Lock",
  };
  if (map[name]) return map[name];
  const rest = name.replace(/^browser_/, "").replace(/_/g, " ");
  return rest ? rest.replace(/\b\w/g, (ch) => ch.toUpperCase()) : "Browser";
}

/** 把 url 收成 host + path，避免摘要过长。 */
export function shortBrowserUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    return parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
  } catch {
    return clip(trimmed, 64);
  }
}

/**
 * Click 卡摘要：优先 args 目标名；否则从 Playwright 代码里抠被点元素；
 * 无图形时只靠这一行交代操作，不展开整段 Page state。
 */
export function browserClickSummary(args: unknown, result?: unknown): string {
  const fromArgs = clip(argText(args, "element") || argText(args, "target"));
  if (fromArgs) return fromArgs;
  const text = toolResultPlainText(result);
  if (!text) return "";
  const errorLine =
    text.match(/^### Result\s*\nError:\s*(.+)$/m)?.[1] ??
    text.match(/^Error:\s*(.+)$/m)?.[1];
  if (errorLine) return clip(errorLine.trim(), 64);
  const fromCode = clickTargetFromPlaywrightCode(text);
  if (fromCode) return fromCode;
  return "";
}

/** 从 `### Ran Playwright code` 代码块抽出最可读的点击目标。 */
function clickTargetFromPlaywrightCode(text: string): string {
  const block = text.match(/```(?:js|ts)?\s*\n([\s\S]*?)```/);
  if (!block?.[1]) return "";
  const clickLine = block[1]
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /\.click\s*\(/.test(line));
  if (!clickLine) return "";
  const named =
    clickLine.match(/name\s*:\s*['"]([^'"]+)['"]/)?.[1] ??
    clickLine.match(/getBy(?:Text|Label|Placeholder|AltText|Title)\(\s*['"]([^'"]+)['"]/)?.[1] ??
    clickLine.match(/getByRole\(\s*['"]([^'"]+)['"]/)?.[1];
  if (named?.trim()) return clip(named.trim(), 48);
  return clip(
    clickLine.replace(/^await\s+/, "").replace(/^page\./, "").replace(/\.click\s*\(\s*\)\s*;?\s*$/, ""),
    56,
  );
}

function toolResultPlainText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";
  const text = (result as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

/**
 * Snapshot 不是截图：是无障碍树文本，给人只留标题/URL 一行。
 * 完整 YAML 给模型找 ref，不必铺进气泡。
 */
export function browserSnapshotSummary(args: unknown, result?: unknown): string {
  const fromArgs =
    clip(argText(args, "filename")) ||
    clip(argText(args, "target")) ||
    clip(argText(args, "element"));
  if (fromArgs) return fromArgs;
  const text = toolResultPlainText(result);
  if (!text) return "";
  const errorLine =
    text.match(/^### Result\s*\nError:\s*(.+)$/m)?.[1] ??
    text.match(/^Error:\s*(.+)$/m)?.[1];
  if (errorLine) return clip(errorLine.trim(), 64);
  const title = text.match(/^- Page Title:\s*(.+)$/m)?.[1]?.trim();
  const url = text.match(/^- Page URL:\s*(.+)$/m)?.[1]?.trim();
  if (title && url) return clip(`${title} · ${shortBrowserUrl(url)}`, 64);
  if (title) return clip(title, 48);
  if (url) return shortBrowserUrl(url);
  return "";
}

/**
 * Screenshot 摘要：有图时副标题尽量短；无图时从结果抽一行说明。
 */
export function browserScreenshotSummary(args: unknown, result?: unknown): string {
  const file = argText(args, "filename");
  if (file) return shortPath(file);
  const element = clip(argText(args, "element") || argText(args, "target"));
  if (element) return element;
  const text = toolResultPlainText(result);
  if (!text) return "";
  const errorLine =
    text.match(/^### Result\s*\nError:\s*(.+)$/m)?.[1] ??
    text.match(/^Error:\s*(.+)$/m)?.[1];
  if (errorLine) return clip(errorLine.trim(), 64);
  const took = text.match(/Took the (.+?) screenshot/i)?.[1]?.trim();
  if (took) return clip(took, 32);
  const saved = text.match(/saved it as (.+)$/m)?.[1]?.trim();
  if (saved) return shortPath(saved);
  return "";
}

/** 按工具挑可读摘要字段。 */
export function browserToolDetail(name: string, args: unknown): string {
  switch (name) {
    case "browser_navigate":
      return shortBrowserUrl(argText(args, "url"));
    case "browser_click":
      return browserClickSummary(args);
    case "browser_hover":
    case "browser_scroll":
      return clip(argText(args, "element") || argText(args, "target"));
    case "browser_type":
    case "browser_fill": {
      const text = clip(argText(args, "text"), 36);
      const element = clip(argText(args, "element") || argText(args, "target"), 28);
      if (text && element) return `${text} · ${element}`;
      return text || element;
    }
    case "browser_fill_form": {
      const fields = args && typeof args === "object" ? (args as { fields?: unknown }).fields : undefined;
      const count = Array.isArray(fields) ? fields.length : 0;
      return count > 0 ? `${count} fields` : "";
    }
    case "browser_snapshot":
      return browserSnapshotSummary(args);
    case "browser_take_screenshot":
      return browserScreenshotSummary(args);
    case "browser_tabs":
      return clip(argText(args, "action"));
    case "browser_wait_for": {
      const text = argText(args, "text");
      const gone = argText(args, "textGone");
      const time = argText(args, "time");
      if (text) return clip(`text: ${text}`);
      if (gone) return clip(`gone: ${gone}`);
      if (time) return `${time}s`;
      return "";
    }
    case "browser_press_key":
      return clip(argText(args, "key"));
    case "browser_select_option": {
      const values = args && typeof args === "object" ? (args as { values?: unknown }).values : undefined;
      if (Array.isArray(values)) {
        const labels = values
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.trim());
        if (labels.length) return clip(labels.join(", "));
      }
      return clip(argText(args, "element") || argText(args, "target"));
    }
    case "browser_drag": {
      const start = argText(args, "startElement") || argText(args, "startTarget");
      const end = argText(args, "endElement") || argText(args, "endTarget");
      if (start && end) return clip(`${start} → ${end}`, 56);
      return clip(start || end);
    }
    case "browser_resize": {
      const width = argText(args, "width");
      const height = argText(args, "height");
      if (width && height) return `${width}×${height}`;
      return "";
    }
    case "browser_evaluate":
      return clip(argText(args, "function") || argText(args, "filename"), 56);
    case "browser_file_upload": {
      const paths = args && typeof args === "object" ? (args as { paths?: unknown }).paths : undefined;
      if (!Array.isArray(paths) || paths.length === 0) return "";
      const first = typeof paths[0] === "string" ? shortPath(paths[0]) : "";
      return paths.length === 1 ? first : `${first} +${paths.length - 1}`;
    }
    case "browser_lock":
      return clip(argText(args, "action"));
    case "browser_handle_dialog": {
      const accept = argText(args, "accept");
      const prompt = argText(args, "promptText");
      if (accept && prompt) return `${accept} · ${clip(prompt, 32)}`;
      return accept || clip(prompt);
    }
    default:
      return (
        shortBrowserUrl(argText(args, "url")) ||
        clip(
          argText(args, "element") ||
            argText(args, "target") ||
            argText(args, "text") ||
            argText(args, "query") ||
            argText(args, "name") ||
            argText(args, "filename"),
        )
      );
  }
}
