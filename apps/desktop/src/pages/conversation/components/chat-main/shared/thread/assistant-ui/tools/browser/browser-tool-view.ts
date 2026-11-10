import { parseMcpToolName, shortPath } from "../shared/tool-args";

/** Playwright / 裸名 `browser_*`（含 `Browser_navigate` 大小写变体）。 */
export function resolveBrowserToolName(toolName: string): string | null {
  const mcp = parseMcpToolName(toolName);
  const bare = (mcp?.tool ?? toolName).trim();
  if (!bare) return null;
  const lower = bare.toLowerCase();
  if (!lower.startsWith("browser_")) return null;
  return lower;
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

/** 按工具挑可读摘要字段。 */
export function browserToolDetail(name: string, args: unknown): string {
  switch (name) {
    case "browser_navigate":
      return shortBrowserUrl(argText(args, "url"));
    case "browser_click":
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
      return clip(argText(args, "target") || argText(args, "filename"));
    case "browser_take_screenshot": {
      const file = argText(args, "filename");
      const element = argText(args, "element") || argText(args, "target");
      if (file) return shortPath(file);
      return clip(element);
    }
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
