import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  PLAYWRIGHT_MCP_NAME,
  PLAYWRIGHT_MCP_PACKAGE,
  PLAYWRIGHT_MCP_VERSION,
  diagnosePlaywrightMcpInstall,
  injectPlaywrightMcp,
  invalidatePlaywrightMcpInstall,
  isPlaywrightMcpInstalled,
  playwrightCliPath,
  playwrightInstallDir,
  playwrightMcpEntry,
  playwrightMcpLaunchPath,
  playwrightStdioConfig,
  playwrightUpstreamCrashLooksLikeCorruptInstall,
  resetPlaywrightMcpInstallForTests,
} from "../src/session/mcp/playwright-platform.js";

afterEach(() => {
  resetPlaywrightMcpInstallForTests();
});

/** 伪造「只剩 cli + ready、缺 zipBundle」的坏树（复现 Win UTM 事故）。 */
function writeCorruptPlaywrightTree(root: string): void {
  const install = playwrightInstallDir(root);
  const cli = playwrightCliPath(root);
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, "export {};\n", "utf8");
  // playwright-core 目录在但无 zipBundle —— 旧自检会误判为已装好
  fs.mkdirSync(path.join(install, "node_modules", "playwright-core", "lib"), { recursive: true });
  fs.writeFileSync(path.join(install, ".agentup-ready"), `${PLAYWRIGHT_MCP_VERSION}\n`, "utf8");
}

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

it("缺 zipBundle 的坏树不算已安装（防 Windows 静默卡死）", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pw-corrupt-"));
  try {
    writeCorruptPlaywrightTree(root);
    expect(fs.existsSync(playwrightCliPath(root))).toBe(true);
    expect(diagnosePlaywrightMcpInstall(root)).toBe("corrupt");
    expect(isPlaywrightMcpInstalled(root)).toBe(false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("完整树（cli + zipBundle）才算 ready", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pw-ok-"));
  try {
    const install = playwrightInstallDir(root);
    const cli = playwrightCliPath(root);
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, "export {};\n", "utf8");
    const coreLib = path.join(install, "node_modules", "playwright-core", "lib");
    fs.mkdirSync(coreLib, { recursive: true });
    fs.writeFileSync(path.join(coreLib, "zipBundle.js"), "module.exports = {};\n", "utf8");
    fs.writeFileSync(path.join(coreLib, "zipBundleImpl.js"), "module.exports = {};\n", "utf8");
    fs.writeFileSync(path.join(install, ".agentup-ready"), `${PLAYWRIGHT_MCP_VERSION}\n`, "utf8");
    expect(diagnosePlaywrightMcpInstall(root)).toBe("ready");
    expect(isPlaywrightMcpInstalled(root)).toBe(true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("invalidate 清掉坏树，便于 ensure 重装", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pw-invalidate-"));
  try {
    writeCorruptPlaywrightTree(root);
    expect(fs.existsSync(playwrightInstallDir(root))).toBe(true);
    invalidatePlaywrightMcpInstall(root);
    expect(fs.existsSync(playwrightInstallDir(root))).toBe(false);
    expect(diagnosePlaywrightMcpInstall(root)).toBe("absent");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("上游 MODULE_NOT_FOUND 秒崩应触发重装判定", () => {
  expect(
    playwrightUpstreamCrashLooksLikeCorruptInstall(
      "Error: Cannot find module '../../zipBundle'\n    at Module._resolveFilename",
      1,
    ),
  ).toBe(true);
  expect(playwrightUpstreamCrashLooksLikeCorruptInstall("Browser closed", 0)).toBe(false);
  expect(playwrightUpstreamCrashLooksLikeCorruptInstall("", null)).toBe(false);
});
