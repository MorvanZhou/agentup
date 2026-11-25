import path from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  PLAYWRIGHT_MCP_NAME,
  PLAYWRIGHT_MCP_PACKAGE,
  PLAYWRIGHT_MCP_VERSION,
  injectPlaywrightMcp,
  playwrightCliPath,
  playwrightInstallDir,
  playwrightMcpEntry,
  playwrightMcpLaunchPath,
  playwrightStdioConfig,
  resetPlaywrightMcpInstallForTests,
} from "../src/session/mcp/playwright-platform.js";

afterEach(() => {
  resetPlaywrightMcpInstallForTests();
});

it("playwright 安装目录在 userData/runtime/playwright-mcp，不走系统 npx", () => {
  const root = "/tmp/agentup-user";
  expect(playwrightInstallDir(root)).toBe(path.join(root, "runtime", "playwright-mcp"));
  expect(playwrightCliPath(root)).toBe(
    path.join(root, "runtime", "playwright-mcp", "node_modules", "@playwright", "mcp", "cli.js"),
  );
  expect(PLAYWRIGHT_MCP_PACKAGE).toBe(`@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`);
});

it("builds a deferred stdio playwright MCP entry via launch + execPath", () => {
  const entry = playwrightMcpEntry("/tmp/agentup-user");
  expect(entry.name).toBe(PLAYWRIGHT_MCP_NAME);
  expect(entry.config).toMatchObject({
    exposure: "deferred",
    command: process.execPath,
  });
  const stdio = playwrightStdioConfig("/tmp/agentup-user");
  expect(stdio.command).toBe(process.execPath);
  expect(stdio.args[0]).toBe(playwrightMcpLaunchPath());
  expect(stdio.args[0]).toMatch(/playwright-mcp-launch\.js$/);
  expect(stdio.args[1]).toBe("/tmp/agentup-user");
  expect(stdio.args).toContain("--headless");
  expect(stdio.args.join(" ")).not.toContain("npx");
  expect(stdio.env.PLAYWRIGHT_BROWSERS_PATH).toContain("playwright-browsers");
  // 只覆盖浏览器路径；整表拷 process.env 会在 Codex config.toml 里炸（点号键→嵌套 map）
  expect(Object.keys(stdio.env)).toEqual(["PLAYWRIGHT_BROWSERS_PATH"]);
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
  expect(next.servers[0]?.config).toMatchObject({
    exposure: "deferred",
    command: process.execPath,
  });
});
