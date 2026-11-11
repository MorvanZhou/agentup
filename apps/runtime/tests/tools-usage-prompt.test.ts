import { expect, it } from "vitest";

import { formatToolsUsagePrompt } from "../src/session/tools/usage-prompt.js";

it("steers models toward dedicated search/read tools instead of the command shell", () => {
  const text = formatToolsUsagePrompt("bash");
  expect(text).toContain("AgentUp Tool Usage");
  expect(text).toContain("`grep`");
  expect(text).toContain("`find`");
  expect(text).toContain("`ls`");
  expect(text).toContain("`read`");
  expect(text).toContain("`edit`");
  expect(text).toContain("`write`");
  expect(text).toContain("`get_local_time`");
  expect(text).toContain("`tool_search`");
  expect(text).toContain("`agent_search`");
  expect(text).toContain("never `bash` with grep/rg");
  expect(text).toContain("never `bash` with date");
  expect(text).toContain("bg_run");
  expect(text).toContain("> ~20s");
  expect(text).toContain("same shell as `bash`");
  expect(text).toContain("shell_hang_decide");
  // 有 tool_search 时提示用 playwright MCP 操作浏览器
  expect(text).toContain("To operate a browser");
  expect(text).toContain("`playwright` MCP");
  expect(text).toContain("mcp__playwright__browser_*");
});

it("names powershell when that is the command tool", () => {
  const text = formatToolsUsagePrompt("powershell");
  expect(text).toContain("never `powershell` with grep/rg");
  expect(text).toContain("Use `powershell` for builds");
  expect(text).toContain("same shell as `powershell`");
});

it("群委派无 bg_run 时仍保留 Playwright MCP 浏览器指引（不绑 background）", () => {
  // 与 TOOL_POLICY group-delegation 形状一致：有 tool_search、无 bg_run
  const text = formatToolsUsagePrompt("bash", { background: false, toolSearch: true });
  expect(text).toContain("To operate a browser");
  expect(text).toContain("`tool_search`");
  expect(text).toContain("`playwright` MCP");
  expect(text).not.toContain("bg_run");
  expect(text).not.toContain("present_preview");
});

it("无 tool_search 时不提 Playwright / deferred MCP", () => {
  const text = formatToolsUsagePrompt("bash", { background: false, toolSearch: false });
  expect(text).not.toContain("Playwright");
  expect(text).not.toContain("tool_search");
  expect(text).not.toContain("mcp__playwright");
});
