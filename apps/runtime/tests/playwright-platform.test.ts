import { expect, it } from "vitest";

import {
  PLAYWRIGHT_MCP_NAME,
  injectPlaywrightMcp,
  playwrightMcpEntry,
  playwrightStdioConfig,
} from "../src/session/mcp/playwright-platform.js";

it("builds a deferred stdio playwright MCP entry", () => {
  const entry = playwrightMcpEntry("/tmp/agentup-user");
  expect(entry.name).toBe(PLAYWRIGHT_MCP_NAME);
  expect(entry.config).toMatchObject({
    exposure: "deferred",
    command: expect.any(String),
  });
  const stdio = playwrightStdioConfig("/tmp/agentup-user");
  expect(stdio.args).toContain("--headless");
  expect(stdio.env.PLAYWRIGHT_BROWSERS_PATH).toContain("playwright-browsers");
});

it("injectPlaywrightMcp forces platform entry over same-named user server", () => {
  const next = injectPlaywrightMcp(
    {
      servers: [
        {
          name: PLAYWRIGHT_MCP_NAME,
          source: "user",
          scope: "global" as const,
          config: { command: "echo", args: [], exposure: "direct" as const },
        },
      ],
      errors: [],
    },
    "/tmp/agentup-user",
  );
  expect(next.servers).toHaveLength(1);
  expect(next.servers[0]?.source).toBe("agentup:platform");
  expect(next.servers[0]?.config).toMatchObject({ exposure: "deferred" });
});
