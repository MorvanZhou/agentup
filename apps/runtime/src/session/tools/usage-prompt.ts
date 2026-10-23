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
): string {
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
    "",
    `Use ${shell} for builds, tests, git, package managers, and other real shell work. For long-running non-specialist commands, prefer \`bg_run\` (then \`bg_status\` / \`bg_kill\`); \`bg_run\` uses the same shell as ${shell}.`,
  ].join("\n");
}
