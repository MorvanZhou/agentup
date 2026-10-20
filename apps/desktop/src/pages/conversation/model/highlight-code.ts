import hljs from "highlight.js/lib/common";

/** 转义为可安全放入 HTML 文本节点的内容。 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 按扩展名推断 highlight.js 语言（仅 common 子集）。 */
export function languageFromPath(path: string): string | undefined {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? path;
  const lower = base.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) {
    if (lower === "makefile" || lower === "gnumakefile") return "makefile";
    if (lower === "dockerfile") return "bash";
    return undefined;
  }
  const ext = lower.slice(dot + 1);
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
    case "tsx":
      return "typescript";
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return "javascript";
    case "py":
      return "python";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "java":
      return "java";
    case "kt":
    case "kts":
      return "kotlin";
    case "c":
    case "h":
      return "c";
    case "cc":
    case "cpp":
    case "cxx":
    case "hpp":
    case "hh":
      return "cpp";
    case "cs":
      return "csharp";
    case "rb":
      return "ruby";
    case "php":
      return "php";
    case "swift":
      return "swift";
    case "json":
    case "jsonc":
      return "json";
    case "yml":
    case "yaml":
      return "yaml";
    case "md":
    case "mdx":
      return "markdown";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "less":
      return "less";
    case "html":
    case "htm":
    case "vue":
    case "svelte":
    case "svg":
    case "xml":
      return "xml";
    case "sh":
    case "bash":
    case "zsh":
      return "bash";
    case "sql":
      return "sql";
    case "graphql":
    case "gql":
      return "graphql";
    case "toml":
    case "ini":
    case "env":
      return "ini";
    case "diff":
    case "patch":
      return "diff";
    case "lua":
      return "lua";
    case "r":
      return "r";
    case "pl":
      return "perl";
    case "wasm":
      return "wasm";
    default:
      return undefined;
  }
}

/**
 * 用 highlight.js 高亮整段代码，返回 HTML（已转义文本 + span）。
 * 未知语言或不支持时回退为纯转义。
 */
export function highlightCodeHtml(source: string, language?: string): string {
  if (!source) return "";
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(source, { language, ignoreIllegals: true }).value;
    } catch {
      /* 非法片段时回退 */
    }
  }
  return escapeHtml(source);
}
