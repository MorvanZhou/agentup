/**
 * 拼进 Pi appendSystemPrompt 的工具选用策略。
 * 不改 Pi 内置 tool description；用平台侧提示纠正「bash 里跑 grep/find/cat」的偏向。
 */
export function formatToolsUsagePrompt(): string {
  return [
    "# AgentUp Tool Usage",
    "",
    "Prefer dedicated tools over shell equivalents. They respect .gitignore, truncate safely, and skip command approval.",
    "",
    "- Content search: use `grep` — never `bash` with grep/rg/ag.",
    "- Find files by name/glob: use `find` — never `bash` with find/fd/locate.",
    "- List a directory: use `ls` — never `bash` with ls.",
    "- Read files: use `read` — never `bash` with cat/head/tail/less.",
    "- Edit existing files: use `edit` — never `bash` with sed/awk/perl -i.",
    "- Create or fully rewrite files: use `write` — never `bash` with echo/printf redirects or heredocs.",
    "",
    "Use `bash` for builds, tests, git, package managers, and other real shell work. For long-running non-specialist commands, prefer `bg_run` (then `bg_status` / `bg_kill`).",
  ].join("\n");
}
