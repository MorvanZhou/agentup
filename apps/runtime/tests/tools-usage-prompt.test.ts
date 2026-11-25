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
  // 有 tool_search 时区分验 preview（playwright）与外站登录态（browser）；一次 search 装齐
  expect(text).toContain("`playwright`");
  expect(text).toContain("mcp__playwright__browser_*");
  expect(text).toContain("`browser`");
  expect(text).toContain("mcp__browser__browser_*");
  expect(text).toContain("whole suite");
  expect(text).toContain("call `mcp__browser__*` directly");
  // 关窗后仍走 browser 重拉 profile，禁止回落无头 playwright
  expect(text).toContain("relaunch");
  expect(text).toContain("Never switch to `mcp__playwright__*`");
  // 本机桌面 Computer Use：读屏只认 inline image，禁 OS 截屏旁路
  expect(text).toContain("`computer`");
  expect(text).toContain("mcp__computer__*");
  expect(text).toContain("get_app_state");
  expect(text).toContain("inline image");
  expect(text).toContain("screencapture");
});

it("names powershell when that is the command tool", () => {
  const text = formatToolsUsagePrompt("powershell");
  expect(text).toContain("never `powershell` with grep/rg");
  expect(text).toContain("Use `powershell` for builds");
  expect(text).toContain("same shell as `powershell`");
});

it("群委派无 bg_run 时仍保留平台浏览器 MCP 指引（不绑 background）", () => {
  // 与 TOOL_POLICY group-delegation 形状一致：有 tool_search、无 bg_run
  const text = formatToolsUsagePrompt("bash", { background: false, toolSearch: true });
  expect(text).toContain("`tool_search`");
  expect(text).toContain("`playwright`");
  expect(text).toContain("`browser`");
  expect(text).toContain("mcp__browser__browser_*");
  expect(text).not.toContain("bg_run");
  expect(text).not.toContain("present_preview");
});

it("无 tool_search 时不提平台浏览器 / deferred MCP", () => {
  const text = formatToolsUsagePrompt("bash", { background: false, toolSearch: false });
  expect(text).not.toContain("mcp__playwright");
  expect(text).not.toContain("mcp__browser");
  expect(text).not.toContain("mcp__computer");
  expect(text).not.toContain("tool_search");
});
