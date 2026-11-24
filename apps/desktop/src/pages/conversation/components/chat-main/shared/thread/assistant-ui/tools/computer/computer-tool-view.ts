import { parseMcpToolName } from "../shared/tool-args";
import {
  browserClickMarker,
  type BrowserClickMarker,
} from "../browser/browser-tool-view";

/** 截图准星：与 Browser 共用比例约定。 */
export type ComputerClickMarker = BrowserClickMarker;

/**
 * 仅认平台 Computer Use：`mcp__computer__*`。
 * 不认裸名 `click`（会与其它工具撞名）。
 */
export function resolveComputerToolName(toolName: string): string | null {
  const mcp = parseMcpToolName(toolName);
  if (!mcp || mcp.server !== "computer") return null;
  const bare = mcp.tool.trim().toLowerCase();
  return bare || null;
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

function toolResultPlainText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";
  const text = (result as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

/** 摘要行标题：App state / Click / … */
export function computerToolTitle(name: string): string {
  const map: Record<string, string> = {
    list_apps: "Apps",
    get_app_state: "App state",
    click: "Click",
    perform_secondary_action: "Secondary",
    scroll: "Scroll",
    drag: "Drag",
    type_text: "Type",
    press_key: "Press key",
    set_value: "Set value",
    select_text: "Select text",
    query: "Query",
    capture_display: "Capture",
  };
  if (map[name]) return map[name];
  const rest = name.replace(/_/g, " ");
  return rest ? rest.replace(/\b\w/g, (ch) => ch.toUpperCase()) : "Computer";
}

/** 应用名：args 优先，兼容 OCU 多种键。 */
export function computerAppLabel(args: unknown): string {
  return clip(
    argText(args, "app") ||
      argText(args, "app_name") ||
      argText(args, "app_name_or_bundle_identifier") ||
      argText(args, "bundle_id") ||
      argText(args, "title"),
  );
}

/**
 * Click 摘要：element_index / 坐标 / 应用名。
 * 无图时只靠这一行交代操作，不展开整段 AX。
 */
export function computerClickSummary(args: unknown, result?: unknown): string {
  const app = computerAppLabel(args);
  const index =
    argText(args, "element_index") ||
    argText(args, "index") ||
    argText(args, "elementIndex");
  if (index) {
    const ref = `#${index.replace(/^#/, "")}`;
    return app ? clip(`${app} · ${ref}`, 56) : ref;
  }
  const x = argText(args, "x");
  const y = argText(args, "y");
  if (x && y) {
    const point = `(${x}, ${y})`;
    return app ? clip(`${app} · ${point}`, 56) : point;
  }
  const fromArgs = clip(
    argText(args, "element") || argText(args, "target") || argText(args, "name"),
  );
  if (fromArgs) return app ? clip(`${app} · ${fromArgs}`, 56) : fromArgs;
  if (app) return app;
  const text = toolResultPlainText(result);
  if (!text) return "";
  const errorLine =
    text.match(/^Error:\s*(.+)$/m)?.[1] ?? text.match(/^### Result\s*\nError:\s*(.+)$/m)?.[1];
  if (errorLine) return clip(errorLine.trim(), 64);
  return "";
}

/**
 * get_app_state 摘要：只要应用名 / 一行状态；完整 AX 给模型，不进摘要。
 */
export function computerAppStateSummary(args: unknown, result?: unknown): string {
  const app = computerAppLabel(args);
  if (app) return app;
  const text = toolResultPlainText(result);
  if (!text) return "";
  const errorLine =
    text.match(/^Error:\s*(.+)$/m)?.[1] ?? text.match(/^### Result\s*\nError:\s*(.+)$/m)?.[1];
  if (errorLine) return clip(errorLine.trim(), 64);
  const named =
    text.match(/^App:\s*(.+)$/m)?.[1]?.trim() ||
    text.match(/^Application:\s*(.+)$/m)?.[1]?.trim() ||
    text.match(/^Window:\s*(.+)$/m)?.[1]?.trim();
  if (named) return clip(named, 48);
  const first = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("{") && line.length < 80);
  return first ? clip(first, 48) : "";
}

/**
 * 无截图时：把长 AX 树收成短说明，避免气泡铺几千字。
 * 有截图时调用方不应展示这段正文。
 */
export function computerAxCollapsedNote(result: unknown, max = 160): string {
  const text = toolResultPlainText(result).trim();
  if (!text) return "";
  const errorLine =
    text.match(/^Error:\s*(.+)$/m)?.[1] ?? text.match(/^### Result\s*\nError:\s*(.+)$/m)?.[1];
  if (errorLine) return clip(errorLine.trim(), 64);
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

/** Type / set_value / press_key 摘要。 */
export function computerTypeSummary(name: string, args: unknown): string {
  const app = computerAppLabel(args);
  if (name === "press_key") {
    const key = clip(argText(args, "key") || argText(args, "keys"), 32);
    if (key && app) return clip(`${key} · ${app}`, 56);
    return key || app;
  }
  if (name === "set_value") {
    const value = clip(argText(args, "value") || argText(args, "text"), 36);
    const index = argText(args, "element_index") || argText(args, "index");
    const bits = [value, index ? `#${index.replace(/^#/, "")}` : "", app].filter(Boolean);
    return clip(bits.join(" · "), 56);
  }
  const text = clip(argText(args, "text") || argText(args, "value"), 36);
  if (text && app) return clip(`${text} · ${app}`, 56);
  return text || app;
}

/** 按工具挑可读摘要。 */
export function computerToolDetail(name: string, args: unknown, result?: unknown): string {
  switch (name) {
    case "list_apps":
      return clip(argText(args, "query") || argText(args, "filter"));
    case "get_app_state":
      return computerAppStateSummary(args, result);
    case "click":
    case "perform_secondary_action":
      return computerClickSummary(args, result);
    case "type_text":
    case "press_key":
    case "set_value":
      return computerTypeSummary(name, args);
    case "scroll": {
      const dir = clip(argText(args, "direction") || argText(args, "delta"));
      const app = computerAppLabel(args);
      if (dir && app) return clip(`${dir} · ${app}`, 56);
      return dir || app;
    }
    case "drag": {
      const start = argText(args, "start_element_index") || argText(args, "from");
      const end = argText(args, "end_element_index") || argText(args, "to");
      if (start && end) return clip(`#${start} → #${end}`, 56);
      return computerAppLabel(args);
    }
    case "select_text":
      return clip(argText(args, "text") || computerAppLabel(args));
    case "query":
      return clip(argText(args, "query") || argText(args, "role") || computerAppLabel(args));
    case "capture_display":
      return clip(argText(args, "display_id") || argText(args, "display"));
    default:
      return (
        computerAppLabel(args) ||
        clip(
          argText(args, "element_index") ||
            argText(args, "text") ||
            argText(args, "key") ||
            argText(args, "query") ||
            argText(args, "name"),
        )
      );
  }
}

/** 从 args / result 抽点击准星；无像素信息则 null（仅 element_index 时叠不了）。 */
export function computerClickMarker(args: unknown, result?: unknown): ComputerClickMarker | null {
  return browserClickMarker(args, result);
}
