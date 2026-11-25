import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  BROWSER_MCP_NAME,
  browserMcpEntry,
  browserStdioConfig,
  browserUpstreamArgs,
  browserUseProfileDir,
  injectBrowserUseMcp,
  readBrowserUseSettings,
  writeBrowserUseSettings,
} from "../src/session/mcp/browser-platform.js";
import { playwrightMcpLaunchPath } from "../src/session/mcp/playwright-platform.js";

it("defaults to headed chrome profile with theater init-script via bridge", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-browser-"));
  expect(readBrowserUseSettings(root)).toEqual({ mode: "profile" });
  const upstream = browserUpstreamArgs(root);
  const profile = browserUseProfileDir(root);
  expect(upstream).toEqual([
    "--browser",
    "chrome",
    "--user-data-dir",
    profile,
    "--init-script",
    expect.stringContaining(`${path.sep}theater-init.js`),
  ]);
  expect(upstream).not.toContain("--headless");
  expect(upstream).not.toContain("--extension");
  expect(upstream).not.toContain("-y");
  expect(fs.existsSync(profile)).toBe(true);

  const stdio = browserStdioConfig(root);
  expect(stdio.command).toBe(process.execPath);
  expect(stdio.args[0]).toContain("mcp-bridge.mjs");
  expect(stdio.env.AGENTUP_BROWSER_UPSTREAM_COMMAND).toBe(process.execPath);
  const upstreamFull = JSON.parse(stdio.env.AGENTUP_BROWSER_UPSTREAM_ARGS_JSON) as string[];
  expect(upstreamFull[0]).toBe(playwrightMcpLaunchPath());
  expect(upstreamFull[1]).toBe(root);
  expect(upstreamFull).toEqual(expect.arrayContaining(["--browser", "chrome", "--user-data-dir"]));
  expect(upstreamFull.join(" ")).not.toContain("npx");
  expect(stdio.exposure).toBe("deferred");
});

it("extension mode is opt-in and still gets theater init-script", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-browser-"));
  writeBrowserUseSettings(root, { mode: "extension" });
  const upstream = browserUpstreamArgs(root);
  expect(upstream[0]).toBe("--extension");
  expect(upstream).toContain("--init-script");
  expect(upstream).not.toContain("--headless");
  expect(upstream).not.toContain("-y");
});

it("injectBrowserUseMcp forces platform entry over same-named user server", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-browser-"));
  const next = injectBrowserUseMcp(
    {
      servers: [
        {
          name: BROWSER_MCP_NAME,
          source: "user",
          scope: "global" as const,
          config: { command: "echo", args: [], exposure: "direct" as const },
        },
      ],
      errors: [],
    },
    root,
  );
  expect(next.servers).toHaveLength(1);
  expect(next.servers[0]?.name).toBe(BROWSER_MCP_NAME);
  expect(next.servers[0]?.source).toBe("agentup:platform");
  expect(next.servers[0]?.config).toMatchObject({ exposure: "deferred" });
  expect(browserMcpEntry(root).name).toBe(BROWSER_MCP_NAME);
});
