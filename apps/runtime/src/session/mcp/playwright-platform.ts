import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import type { McpServerEntry } from "@earendil-works/pi-coding-agent";

import { resolveNpxRunner } from "../../config/npm-runner.js";
import { shouldWindowsHideChild } from "../windows-hide.js";

/** 平台注入的 Playwright MCP 名（强制 deferred）。 */
export const PLAYWRIGHT_MCP_NAME = "playwright";

/** 钉版本，避免 npx latest 漂移。 */
export const PLAYWRIGHT_MCP_PACKAGE = "@playwright/mcp@0.0.46";

let installPromise: Promise<void> | null = null;

export function playwrightBrowsersDir(userDataRoot: string): string {
  return path.join(userDataRoot, "runtime", "playwright-browsers");
}

/** Windows 禁用 npx.cmd（会经 cmd.exe 弹窗）；一律 node + npx-cli.js。 */
function npxInvocation(): { command: string; prefixArgs: string[] } {
  const runner = resolveNpxRunner();
  if (runner) return { command: runner.command, prefixArgs: runner.args };
  if (process.platform === "win32") {
    throw new Error(
      "找不到 npx-cli.js，无法启动 Playwright MCP。请重装 AgentUp，或安装 Node.js 并加入 PATH。",
    );
  }
  return { command: "npx", prefixArgs: [] };
}

/** 厂商 SDK / Pi 共用的 stdio MCP 形。 */
export function playwrightStdioConfig(userDataRoot: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
  exposure: "deferred";
} {
  const browsers = playwrightBrowsersDir(userDataRoot);
  const npx = npxInvocation();
  // 只覆盖浏览器路径；勿整表拷 process.env。
  // Pi 默认 inheritEnv merge；Codex 会把 env 展平进 config.toml，
  // 带 `.` 的键（如 asl.foo）会变成嵌套 map →「expected a string」。
  return {
    command: npx.command,
    args: [...npx.prefixArgs, "-y", PLAYWRIGHT_MCP_PACKAGE, "--headless"],
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
  if (installPromise) return installPromise;
  installPromise = (async () => {
    const browsers = playwrightBrowsersDir(userDataRoot);
    fs.mkdirSync(browsers, { recursive: true });
    const ready = path.join(browsers, ".agentup-ready");
    if (fs.existsSync(ready)) return;
    await runPlaywrightInstall(browsers);
    fs.writeFileSync(ready, `${Date.now()}\n`, "utf8");
  })().catch((error) => {
    installPromise = null;
    throw error;
  });
  return installPromise;
}

function runPlaywrightInstall(browsersPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let npx: { command: string; prefixArgs: string[] };
    try {
      npx = npxInvocation();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const child = spawn(
      npx.command,
      [...npx.prefixArgs, "-y", "playwright", "install", "chromium"],
      {
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath },
        stdio: ["ignore", "pipe", "pipe"],
        // 禁止 shell:true（Win 会经 cmd 弹窗）；直接跑 node/npx-cli
        windowsHide: shouldWindowsHideChild(),
      },
    );
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
  // 预热安装（异步，不阻塞开会话；体验近似等 bg_run）
  void ensurePlaywrightBrowsers(userDataRoot).catch(() => undefined);
  return { ...config, servers };
}
