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
});

it("names powershell when that is the command tool", () => {
  const text = formatToolsUsagePrompt("powershell");
  expect(text).toContain("never `powershell` with grep/rg");
  expect(text).toContain("Use `powershell` for builds");
  expect(text).toContain("same shell as `powershell`");
});
