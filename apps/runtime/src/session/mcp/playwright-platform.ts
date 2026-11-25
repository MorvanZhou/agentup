import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { McpServerEntry } from "@earendil-works/pi-coding-agent";

import { resolveNpmRunner } from "../../config/npm-runner.js";
import { shouldWindowsHideChild } from "../windows-hide.js";

/** 平台注入的 Playwright MCP 名（强制 deferred）。 */
export const PLAYWRIGHT_MCP_NAME = "playwright";

/**
 * 钉版本，避免 latest 漂移。
 * 与 Browser Use 共用同一份本地安装（勿再经 npx.cmd → cmd 弹窗）。
 */
export const PLAYWRIGHT_MCP_PACKAGE = "@playwright/mcp@0.0.46";

/** 包名（不含版本），用于 node_modules 路径。 */
export const PLAYWRIGHT_MCP_PACKAGE_NAME = "@playwright/mcp";

/** 钉死版本号，写入 `.agentup-ready` 便于升级重装。 */
export const PLAYWRIGHT_MCP_VERSION = "0.0.46";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let mcpInstallPromise: Promise<void> | null = null;
let browsersInstallPromise: Promise<void> | null = null;

/** `<userDataRoot>/runtime/playwright-mcp`：AgentUp 自管安装前缀。 */
export function playwrightInstallDir(userDataRoot: string): string {
  return path.join(userDataRoot, "runtime", "playwright-mcp");
}

/** 已安装 CLI：`node_modules/@playwright/mcp/cli.js`（勿走 .cmd）。 */
export function playwrightCliPath(userDataRoot: string): string {
  return path.join(
    playwrightInstallDir(userDataRoot),
    "node_modules",
    ...PLAYWRIGHT_MCP_PACKAGE_NAME.split("/"),
    "cli.js",
  );
}

/** 同前缀里的 playwright CLI，用于 `install chromium`。 */
export function playwrightBrowserCliPath(userDataRoot: string): string {
  return path.join(playwrightInstallDir(userDataRoot), "node_modules", "playwright", "cli.js");
}

/** MCP 启动器：先 ensure 再跑 cli.js（避免首用竞态 / 禁 npx）。 */
export function playwrightMcpLaunchPath(): string {
  return path.join(HERE, "playwright-mcp-launch.js");
}

export function playwrightBrowsersDir(userDataRoot: string): string {
  return path.join(userDataRoot, "runtime", "playwright-browsers");
}

function mcpReadyMarkerPath(userDataRoot: string): string {
  return path.join(playwrightInstallDir(userDataRoot), ".agentup-ready");
}

function browsersReadyMarkerPath(userDataRoot: string): string {
  return path.join(playwrightBrowsersDir(userDataRoot), ".agentup-ready");
}

/** 盘上已是钉版且 cli.js 存在。 */
export function isPlaywrightMcpInstalled(userDataRoot: string): boolean {
  const ready = mcpReadyMarkerPath(userDataRoot);
  if (!fs.existsSync(ready)) return false;
  try {
    const version = fs.readFileSync(ready, "utf8").trim();
    if (version !== PLAYWRIGHT_MCP_VERSION) return false;
  } catch {
    return false;
  }
  return fs.existsSync(playwrightCliPath(userDataRoot));
}

/**
 * 用 AgentUp 钉版 npm 装到 `<userDataRoot>/runtime/playwright-mcp`。
 * 与 Computer Use 同形：临时目录 → 自检 → rename；失败可重试。
 */
export function ensurePlaywrightMcpInstalled(userDataRoot: string): Promise<void> {
  if (mcpInstallPromise) return mcpInstallPromise;
  mcpInstallPromise = (async () => {
    if (isPlaywrightMcpInstalled(userDataRoot)) return;
    await installPlaywrightMcp(userDataRoot);
  })().catch((error) => {
    mcpInstallPromise = null;
    throw error;
  });
  return mcpInstallPromise;
}

/** 单测可清掉 in-flight Promise。 */
export function resetPlaywrightMcpInstallForTests(): void {
  mcpInstallPromise = null;
  browsersInstallPromise = null;
}

async function installPlaywrightMcp(userDataRoot: string): Promise<void> {
  const runner = resolveNpmRunner();
  if (!runner) {
    throw new Error("无法定位 npm（需要 AgentUp 钉版 npm 或系统 Node 旁的 npm-cli.js）");
  }

  const target = playwrightInstallDir(userDataRoot);
  const tmp = path.join(path.dirname(target), `playwright-mcp.tmp-${randomUUID()}`);
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    `${JSON.stringify({ name: "agentup-playwright-mcp", version: "1.0.0", private: true }, null, 2)}\n`,
  );

  try {
    await runNpmInstall(runner, tmp);
    const cli = path.join(tmp, "node_modules", ...PLAYWRIGHT_MCP_PACKAGE_NAME.split("/"), "cli.js");
    if (!fs.existsSync(cli)) {
      throw new Error("@playwright/mcp 安装完成但未找到 cli.js，已回滚");
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(tmp, target);
    fs.writeFileSync(mcpReadyMarkerPath(userDataRoot), `${PLAYWRIGHT_MCP_VERSION}\n`, "utf8");
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}

function runNpmInstall(
  runner: { command: string; args: string[] },
  prefix: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const execDir = path.dirname(runner.command);
    const env = {
      ...process.env,
      PATH: `${execDir}${path.delimiter}${process.env.PATH ?? ""}`,
      npm_config_audit: "false",
      npm_config_fund: "false",
      ...(process.env.HOME ? {} : { HOME: os.homedir() }),
    };
    const child = spawn(
      runner.command,
      [
        ...runner.args,
        "install",
        "--prefix",
        prefix,
        PLAYWRIGHT_MCP_PACKAGE,
        "--no-audit",
        "--no-fund",
      ],
      { env, cwd: prefix, stdio: ["ignore", "pipe", "pipe"], windowsHide: shouldWindowsHideChild() },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `npm install ${PLAYWRIGHT_MCP_PACKAGE} failed (${code})`));
    });
  });
}

/** 厂商 SDK / Pi 共用的 stdio MCP 形：经启动器，永不 npx。 */
export function playwrightStdioConfig(userDataRoot: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
  exposure: "deferred";
} {
  const browsers = playwrightBrowsersDir(userDataRoot);
  // 只覆盖浏览器路径；勿整表拷 process.env。
  // Pi 默认 inheritEnv merge；Codex 会把 env 展平进 config.toml，
  // 带 `.` 的键（如 asl.foo）会变成嵌套 map →「expected a string」。
  return {
    command: process.execPath,
    args: [playwrightMcpLaunchPath(), userDataRoot, "--headless"],
    env: { PLAYWRIGHT_BROWSERS_PATH: browsers },
    exposure: "deferred",
  };
}

/** Pi LoadedMcpConfig 条目：平台注入，强制 deferred。 */
export function playwrightMcpEntry(userDataRoot: string): McpServerEntry {
  const stdio = playwrightStdioConfig(userDataRoot);
  return {
    name: PLAYWRIGHT_MCP_NAME,
    source: "agentup:platform",
    scope: "global",
    config: {
      command: stdio.command,
      args: stdio.args,
      env: stdio.env,
      exposure: "deferred",
    },
  };
}

/**
 * 首用异步安装 Chromium 到 userData（无确认）。
 * 并发调用共享同一 Promise；失败不 latch，可重试。
 */
export function ensurePlaywrightBrowsers(userDataRoot: string): Promise<void> {
  if (browsersInstallPromise) return browsersInstallPromise;
  browsersInstallPromise = (async () => {
    await ensurePlaywrightMcpInstalled(userDataRoot);
    const browsers = playwrightBrowsersDir(userDataRoot);
    fs.mkdirSync(browsers, { recursive: true });
    const ready = browsersReadyMarkerPath(userDataRoot);
    if (fs.existsSync(ready)) return;
    await runPlaywrightInstall(userDataRoot, browsers);
    fs.writeFileSync(ready, `${Date.now()}\n`, "utf8");
  })().catch((error) => {
    browsersInstallPromise = null;
    throw error;
  });
  return browsersInstallPromise;
}

function runPlaywrightInstall(userDataRoot: string, browsersPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cli = playwrightBrowserCliPath(userDataRoot);
    if (!fs.existsSync(cli)) {
      reject(new Error("playwright CLI 未找到（请先完成 @playwright/mcp 本地安装）"));
      return;
    }
    const child = spawn(process.execPath, [cli, "install", "chromium"], {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: shouldWindowsHideChild(),
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `playwright install failed (${code})`));
    });
  });
}

/** 合并平台 Playwright：同名强制覆盖为 deferred 平台条目。 */
export function injectPlaywrightMcp<T extends { servers: McpServerEntry[] }>(
  config: T,
  userDataRoot: string,
): T {
  const entry = playwrightMcpEntry(userDataRoot);
  const servers = config.servers.filter((server) => server.name !== PLAYWRIGHT_MCP_NAME);
  servers.push(entry);
  // 预热安装（异步，不阻塞开会话；启动器仍会再 ensure 一次）
  void ensurePlaywrightMcpInstalled(userDataRoot).catch(() => undefined);
  void ensurePlaywrightBrowsers(userDataRoot).catch(() => undefined);
  return { ...config, servers };
}
