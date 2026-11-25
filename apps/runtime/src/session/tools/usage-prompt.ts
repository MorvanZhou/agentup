import {
  detectHostEnvironment,
  type CommandToolName,
} from "../environment.js";

/**
 * 拼进 Pi appendSystemPrompt 的工具选用策略。
 * 不改 Pi 内置 tool description；用平台侧提示纠正「shell 里跑 grep/find/cat」的偏向。
 */
export function formatToolsUsagePrompt(
  commandTool: CommandToolName = detectHostEnvironment().commandTool,
  options: { background?: boolean; toolSearch?: boolean } = {},
): string {
  const background = options.background !== false;
  const toolSearch = options.toolSearch !== false;
  const shell = `\`${commandTool}\``;
  return [
    "# AgentUp Tool Usage",
    "",
    "Prefer dedicated tools over shell equivalents. They respect .gitignore, truncate safely, and skip command approval.",
    "",
    `- Content search: use \`grep\` — never ${shell} with grep/rg/ag.`,
    `- Find files by name/glob: use \`find\` — never ${shell} with find/fd/locate.`,
    `- List a directory: use \`ls\` — never ${shell} with ls / Get-ChildItem for simple listing.`,
    `- Read files: use \`read\` — never ${shell} with cat/head/tail/less / Get-Content.`,
    `- Edit existing files: use \`edit\` — never ${shell} with sed/awk/perl -i.`,
    `- Create or fully rewrite files: use \`write\` — never ${shell} with echo/printf redirects or heredocs.`,
    `- Current local date/time: use \`get_local_time\` — never ${shell} with date / Get-Date for ordinary clock reads.`,
    ...(toolSearch
      ? [
          "- MCP / deferred tools: call `tool_search` with a short query first (same idea as `agent_search`), then use the loaded tools. Do not assume MCP tools are already declared.",
          // 两套平台浏览器 MCP：验 preview vs 外站登录态；一次 search 装齐套件；历史名可直接调
          "- To verify a local `preview_url` / CI-style page check, `tool_search` once for platform `playwright` (`mcp__playwright__browser_*`, headless) — that loads the whole suite (navigate/click/type/snapshot/…).",
          "- For logged-in external sites, `tool_search` once for platform `browser` (`mcp__browser__browser_*`, headed profile). Prefer `browser` over inventing a Bash/Playwright harness. After that search (or if this session already used those names), call `mcp__browser__*` directly — do not re-search each step. If the headed window was closed, keep calling `mcp__browser__*` (same profile relaunches). Never switch to `mcp__playwright__*` for that task — headless has no that login, even if `tool_search` lists playwright. The headed window shows a simulated cursor; click/type results may include a screenshot for the user — do not dump huge page YAML into chat.",
          "- For native desktop apps (Finder, Calculator, System Settings, Electron apps), `tool_search` once for platform `computer` (`mcp__computer__*`, accessibility-first). Prefer element refs from `get_app_state` over pixel clicks. Screenshots are **inline image** parts in `mcp__computer__*` tool results — read those images; do not search disk for PNGs. Never use OS `screencapture` / AppleScript / CGWindow / ScreenCaptureKit / custom crop scripts (wrong coordinate space; often captures Electron/AgentUp or blank). If the image is hard to read, call `get_app_state` again. Prefer shell/API/files when they solve the task without UI. Do not use `computer` for ordinary web pages — use `browser` / `playwright`. macOS needs Accessibility + Screen Recording granted to Open Computer Use.",
        ]
      : []),
    "",
    `Use ${shell} for builds, tests, git, package managers, and other real shell work.`,
    ...(background
      ? [
          `Duration rule: if a command may take > ~20s (builds, watches, migrations, heavy scripts, installs), prefer \`bg_run\` instead of blocking ${shell}; then \`bg_status\` / \`bg_kill\`. Short commands stay on ${shell}. \`bg_run\` uses the same shell as ${shell}.`,
          "After \`bg_run\` starts a local web server the user should see, call \`present_preview\` with the localhost URL and the restart command. Static ARTIFACT HTML/MD/images use the file preview UI instead.",
        ]
      : []),
    `Idle hang: if blocking ${shell} stops producing output but does not exit (open timers, servers, setInterval), runtime parks it and asks you to call \`shell_hang_decide\` (kill|wait|bg). Prefer kill when the useful work is done; headless scripts should clear timers or \`process.exit\`.`,
  ].join("\n");
}
