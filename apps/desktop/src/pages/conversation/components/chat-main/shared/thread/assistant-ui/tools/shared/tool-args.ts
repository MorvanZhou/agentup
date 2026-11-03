/** 从工具 args 里取字符串字段。 */
export function argString(args: unknown, key: string): string {
  if (!args || typeof args !== "object") return "";
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

/**
 * 从可能不完整的 JSON argsText 里抽出字符串字段（供 Write/Edit 流式预览）。
 * 已闭合的 JSON 优先 parse；否则按 `"key":"..."` 扫描并处理常见转义。
 */
export function partialJsonStringField(argsText: string, key: string): string {
  const text = argsText.trim();
  if (!text || !key) return "";
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string") return value;
    }
  } catch {
    // 流式中尚未成合法 JSON
  }
  const needle = `"${key}"`;
  const keyAt = text.indexOf(needle);
  if (keyAt < 0) return "";
  let i = keyAt + needle.length;
  while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) {
    i += 1;
  }
  if (text[i] !== ":") return "";
  i += 1;
  while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) {
    i += 1;
  }
  if (text[i] !== '"') return "";
  i += 1;
  let out = "";
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') break;
    if (ch === "\\" && i + 1 < text.length) {
      const next = text[i + 1]!;
      if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else if (next === "t") out += "\t";
      else if (next === '"' || next === "\\" || next === "/") out += next;
      else if (next === "u" && i + 5 < text.length) {
        const hex = text.slice(i + 2, i + 6);
        const code = Number.parseInt(hex, 16);
        out += Number.isFinite(code) ? String.fromCharCode(code) : `\\u${hex}`;
        i += 6;
        continue;
      } else out += next;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** 已解析 args 优先；缺字段时用 argsText 半解析补齐（流式 Write/Edit）。 */
export function mergeToolArgs(args: unknown, argsText: string): Record<string, unknown> {
  const base =
    args && typeof args === "object" && !Array.isArray(args)
      ? { ...(args as Record<string, unknown>) }
      : {};
  if (!argsText.trim()) return base;
  const fill = (key: string, value: unknown) => {
    const current = base[key];
    if (typeof current === "string" && current) return;
    if (current !== undefined && current !== null && current !== "") return;
    if (value !== undefined) base[key] = value;
  };
  try {
    const parsed: unknown = JSON.parse(argsText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        fill(key, value);
      }
      return base;
    }
  } catch {
    // fall through
  }
  for (const key of [
    "path",
    "file_path",
    "content",
    "oldText",
    "newText",
    "old_string",
    "new_string",
    "command",
    "cmd",
    "script",
    "job_id",
    "name",
    "hang_id",
    "action",
  ]) {
    const value = partialJsonStringField(argsText, key);
    if (value) fill(key, value);
  }
  if (typeof base.oldText !== "string" && typeof base.old_string === "string") {
    base.oldText = base.old_string;
  }
  if (typeof base.newText !== "string" && typeof base.new_string === "string") {
    base.newText = base.new_string;
  }
  return base;
}

/** 展示路径时只保留末两段，避免气泡被撑满。 */
export function shortPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return path;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return parts.slice(-2).join("/");
}

/** 解析 Pi MCP 工具名 `mcp__<server>__<tool>`。 */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith("mcp__")) return null;
  const rest = name.slice("mcp__".length);
  const sep = rest.indexOf("__");
  if (sep <= 0) return null;
  const server = rest.slice(0, sep);
  const tool = rest.slice(sep + 2);
  if (!server || !tool) return null;
  return { server, tool };
}

/**
 * Cursor 元工具 `mcp` + `{ providerIdentifier, toolName, args }` → 与 CodeBuddy 同形名。
 * 新会话应由 runtime `unwrapCursorMcpTool` 落盘；这里兜底旧 transcript / 漏解包。
 */
export function unwrapAgentUpMcpShell(
  toolName: string,
  args: unknown,
): { toolName: string; args: Record<string, unknown> } {
  const row =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  if (toolName !== "mcp") return { toolName, args: row };

  const nestedName = typeof row.toolName === "string" ? row.toolName.trim() : "";
  if (!nestedName) return { toolName, args: row };
  const provider =
    typeof row.providerIdentifier === "string" ? row.providerIdentifier.trim() : "";
  const inner =
    row.args && typeof row.args === "object" && !Array.isArray(row.args)
      ? (row.args as Record<string, unknown>)
      : {};

  if (nestedName === "agentup_ask_user") {
    return {
      toolName: "ask_user",
      args: Object.keys(inner).length > 0 ? inner : row,
    };
  }
  if (provider === "agentup") {
    return { toolName: `mcp__agentup__${nestedName}`, args: inner };
  }
  return { toolName, args: row };
}

/** 从 args 里挑几个常见字符串字段拼成摘要。 */
export function summarizeArgs(args: unknown, keys: readonly string[]): string {
  const parts: string[] = [];
  for (const key of keys) {
    const value = argString(args, key).trim();
    if (!value) continue;
    parts.push(key === "path" || key === "uri" || key === "file_path" ? shortPath(value) : value);
    if (parts.length >= 2) break;
  }
  return parts.join(" · ");
}

/**
 * GenericTool 摘要：兼容 Pi 常见键，以及外部 SDK 壳（ToolSearch / DeferExecuteTool）。
 * 优先扁平字符串；再挖 `params` / `input`；数组只取前几项。
 */
export function summarizeGenericToolArgs(args: unknown): string {
  const preferred = summarizeArgs(args, [
    "path",
    "file_path",
    "command",
    "cmd",
    "uri",
    "query",
    "pattern",
    "name",
    "toolName",
    "tool_name",
    "description",
    "brief",
  ]);
  if (preferred) {
    // DeferExecute：toolName + params.query/brief 拼一行
    const nested = nestedToolSummary(args);
    if (nested && !preferred.includes(nested)) return `${preferred} · ${nested}`;
    return preferred;
  }
  const fromNames = toolNamesSummary(args);
  if (fromNames) return fromNames;
  const nested = nestedToolSummary(args);
  if (nested) return nested;
  return firstShortArgSummary(args);
}

function nestedToolSummary(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const row = args as Record<string, unknown>;
  for (const key of ["params", "input", "arguments"]) {
    const nested = row[key];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    const hit = summarizeArgs(nested, ["query", "brief", "command", "cmd", "path", "name", "agent_id"]);
    if (hit) return hit;
  }
  return "";
}

function toolNamesSummary(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const names = (args as Record<string, unknown>).tool_names;
  if (!Array.isArray(names)) return "";
  const labels = names
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  if (labels.length === 0) return "";
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")}…`;
}

function firstShortArgSummary(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (key === "raw") continue;
    if (typeof value === "string" && value.trim()) {
      const text = value.trim();
      parts.push(text.length > 80 ? `${text.slice(0, 80)}…` : text);
    } else if (typeof value === "number" || typeof value === "boolean") {
      parts.push(String(value));
    }
    if (parts.length >= 2) break;
  }
  return parts.join(" · ");
}

/** 工具是否仍在进行中（扫光）。取消与错误视为已结束。 */
export function isToolProgressActive(
  statusType: string,
  options?: {
    cancelled?: boolean;
    error?: boolean;
    /** 尚无最终 result（含等执行）。 */
    hasResult?: boolean;
    isPreliminary?: boolean;
    /** 本机审批弹窗正等待该工具的决定。 */
    awaitingApproval?: boolean;
  },
): boolean {
  if (options?.cancelled || options?.error) return false;
  if (options?.awaitingApproval || options?.isPreliminary) return true;
  // assistant-ui：无 result 时 part.status 常等于 message.status，
  // 等工具执行时常为 requires-action，不只是 running。
  if (options?.hasResult === false) return true;
  if (statusType === "running" || statusType === "requires-action") return true;
  if (statusType === "incomplete") return true;
  return false;
}

/** 是否为应用退出后愈合写入的中断结果（含 ask_user / 审批中 / 执行中工具）。 */
export function isInterruptedToolOutput(value: unknown): boolean {
  const text =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "error" in value
        ? String((value as { error: unknown }).error ?? "")
        : value == null
          ? ""
          : String(value);
  return /interrupted|中断|Session was interrupted|app exited before/i.test(text);
}

/** 从工具失败结果里取出可读正文。assistant-ui 常把 errorText 包成 `{ error }`。 */
function toolErrorBody(result: unknown): string {
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (trimmed.startsWith("{")) {
      try {
        const inner = errorField(JSON.parse(trimmed) as unknown);
        if (inner) return inner;
      } catch {
        // 不是 JSON，按原文展示
      }
    }
    return result;
  }
  const inner = errorField(result);
  if (inner) return inner;
  if (result == null) return "";
  return formatToolResult(result);
}

function errorField(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const error = (value as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  return "";
}

/**
 * 工具把自己的失败写成 `Error: …`，或 assistant-ui 包成 `{ error }`。
 * 普通输出里中途出现的 Error 不算（例如 grep 命中行）。
 */
export function isToolFailureOutput(result: unknown): boolean {
  if (errorField(result)) return true;
  const text = toolErrorBody(result).trim();
  return /^error\s*:/i.test(text);
}

/**
 * 工具失败文案：统一成截图里的 `Error: …`。
 * 已带 Error 前缀的原文保持不动；空结果只留 Error。
 */
export function formatToolErrorMessage(result: unknown, label = "Error"): string {
  const trimmed = toolErrorBody(result).trim();
  if (!trimmed) return label;
  const head = trimmed.slice(0, label.length);
  const next = trimmed[label.length];
  const alreadyLabeled =
    head.toLowerCase() === label.toLowerCase() &&
    (next === undefined || next === ":" || next === " " || next === "\n");
  return formatToolResult(alreadyLabeled ? trimmed : `${label}: ${trimmed}`);
}

/**
 * 解开 Cursor / 部分 MCP 工具结果外壳，抽出给人看的正文。
 * 形如 `{status,value:{content:[{text:{text:"…"}}]}}` 或同构 JSON 字符串。
 * CodeBuddy 已是纯文本时原样返回。
 */
export function unwrapSdkToolResultText(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return raw;
    try {
      return unwrapSdkToolResultText(JSON.parse(trimmed) as unknown) || raw;
    } catch {
      return raw;
    }
  }
  if (typeof raw !== "object") return String(raw);

  const row = raw as Record<string, unknown>;
  // Cursor MCP：{ status, value: { content: [...], isError } }
  if (row.value && typeof row.value === "object" && !Array.isArray(row.value)) {
    const fromValue = unwrapSdkToolResultText(row.value);
    if (fromValue) return fromValue;
  }
  // MCP content 块数组
  if (Array.isArray(row.content)) {
    const parts = row.content
      .map((item) => unwrapContentBlock(item))
      .filter(Boolean);
    if (parts.length > 0) return parts.join("\n");
  }
  // 单块 { type:"text", text:"…" } 或 Cursor 嵌套 { text: { text:"…" } }
  const block = unwrapContentBlock(raw);
  if (block) return block;

  try {
    return JSON.stringify(raw, null, 2) ?? String(raw);
  } catch {
    return String(raw);
  }
}

function unwrapContentBlock(item: unknown): string {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  const row = item as Record<string, unknown>;
  if (typeof row.text === "string") return row.text;
  if (row.text && typeof row.text === "object" && !Array.isArray(row.text)) {
    const nested = row.text as Record<string, unknown>;
    if (typeof nested.text === "string") return nested.text;
  }
  if (typeof row.content === "string") return row.content;
  return "";
}

/** 结果预览：先解 SDK/MCP 壳，过长时截断。 */
export function formatToolResult(result: unknown, maxChars = 2400): string {
  const text = unwrapSdkToolResultText(result);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…`;
}
