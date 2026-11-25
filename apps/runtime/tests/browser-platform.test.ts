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
  normalizeBrowserPath,
  readBrowserUseSettings,
  writeBrowserUseSettings,
  type BrowserUseLaunchHost,
} from "../src/session/mcp/browser-platform.js";
import { playwrightBrowsersDir, playwrightMcpLaunchPath } from "../src/session/mcp/playwright-platform.js";

function winHost(installed: string[]): BrowserUseLaunchHost {
  const set = new Set(installed.map((p) => normalizeBrowserPath(p, "win32")));
  return {
    platform: "win32",
    env: {
      PROGRAMFILES: "C:\\Program Files",
      "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
    },
    existsSync: (p) => set.has(normalizeBrowserPath(p, "win32")),
  };
}

it("defaults to headed chrome profile with theater init-script via bridge", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-browser-"));
  const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const host = winHost([chrome]);
  expect(readBrowserUseSettings(root)).toEqual({ mode: "profile" });
  const upstream = browserUpstreamArgs(root, host);
  const profile = browserUseProfileDir(root, "chrome");
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

  const stdio = browserStdioConfig(root, host);
  expect(stdio.command).toBe(process.execPath);
  expect(stdio.args[0]).toContain("mcp-bridge.mjs");
  expect(stdio.env.AGENTUP_BROWSER_USER_DATA_ROOT).toBe(root);
  expect(stdio.env.AGENTUP_BROWSER_UPSTREAM_COMMAND).toBe(process.execPath);
  expect(stdio.env.PLAYWRIGHT_BROWSERS_PATH).toBeUndefined();
  expect(stdio.env.AGENTUP_BROWSER_ENSURE_BROWSERS).toBeUndefined();
  const upstreamFull = JSON.parse(stdio.env.AGENTUP_BROWSER_UPSTREAM_ARGS_JSON) as string[];
  expect(upstreamFull[0]).toBe(playwrightMcpLaunchPath());
  expect(upstreamFull[1]).toBe(root);
  expect(upstreamFull).toEqual(expect.arrayContaining(["--browser", "chrome", "--user-data-dir"]));
  expect(upstreamFull.join(" ")).not.toContain("npx");
  expect(stdio.exposure).toBe("deferred");
});

it("无 Chrome 时回落 Edge；无系统浏览器时回落钉版 chromium 并带 browsers 环境", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-browser-"));
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const edgeUpstream = browserUpstreamArgs(root, winHost([edge]));
  expect(edgeUpstream).toEqual(
    expect.arrayContaining([
      "--browser",
      "msedge",
      "--user-data-dir",
      browserUseProfileDir(root, "msedge"),
    ]),
  );

  const chromiumStdio = browserStdioConfig(root, winHost([]));
  expect(chromiumStdio.env.PLAYWRIGHT_BROWSERS_PATH).toBe(playwrightBrowsersDir(root));
  expect(chromiumStdio.env.AGENTUP_BROWSER_ENSURE_BROWSERS).toBe("1");
  const chromiumArgs = JSON.parse(chromiumStdio.env.AGENTUP_BROWSER_UPSTREAM_ARGS_JSON) as string[];
  expect(chromiumArgs).toEqual(
    expect.arrayContaining([
      "--browser",
      "chromium",
      "--user-data-dir",
      browserUseProfileDir(root, "chromium"),
    ]),
  );
});

it("extension mode is opt-in and still gets theater init-script", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-browser-"));
  writeBrowserUseSettings(root, { mode: "extension" });
  const upstream = browserUpstreamArgs(root, winHost([]));
  expect(upstream[0]).toBe("--extension");
  expect(upstream).toContain("--init-script");
  expect(upstream).not.toContain("--headless");
  expect(upstream).not.toContain("-y");
  expect(browserStdioConfig(root, winHost([])).env.AGENTUP_BROWSER_ENSURE_BROWSERS).toBeUndefined();
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
    winHost(["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"]),
  );
  expect(next.servers).toHaveLength(1);
  expect(next.servers[0]?.name).toBe(BROWSER_MCP_NAME);
  expect(next.servers[0]?.source).toBe("agentup:platform");
  expect(next.servers[0]?.config).toMatchObject({ exposure: "deferred" });
  expect(browserMcpEntry(root, winHost([])).name).toBe(BROWSER_MCP_NAME);
});
