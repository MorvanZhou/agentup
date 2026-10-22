import { expect, it } from "vitest";

import { formatToolsUsagePrompt } from "../src/session/tools/usage-prompt.js";

it("steers models toward dedicated search/read tools instead of bash", () => {
  const text = formatToolsUsagePrompt();
  expect(text).toContain("AgentUp Tool Usage");
  expect(text).toContain("`grep`");
  expect(text).toContain("`find`");
  expect(text).toContain("`ls`");
  expect(text).toContain("`read`");
  expect(text).toContain("`edit`");
  expect(text).toContain("`write`");
  expect(text).toContain("never `bash` with grep/rg");
  expect(text).toContain("bg_run");
});
