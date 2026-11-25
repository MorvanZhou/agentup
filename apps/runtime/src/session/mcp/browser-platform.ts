import fs from "node:fs";
import path from "node:path";

import type { McpServerEntry } from "@earendil-works/pi-coding-agent";

import { ensureBrowserTheaterAssets } from "./browser-theater/ensure-assets.js";
import {
  resolveBrowserUseLaunch,
  type BrowserUseLaunch,
  type BrowserUseLaunchHost,
} from "./browser-use-launch.js";
import {
  ensurePlaywrightBrowsers,
  ensurePlaywrightMcpInstalled,
  playwrightBrowsersDir,
  playwrightMcpLaunchPath,
} from "./playwright-platform.js";

export {
  browserUseCandidatePaths,
  browserUseProfileDir,
  normalizeBrowserPath,
  resolveBrowserUseLaunch,
  type BrowserUseEngine,
  type BrowserUseLaunch,
  type BrowserUseLaunchHost,
} from "./browser-use-launch.js";

/** 平台 Browser Use MCP 名（外站登录态；强制 deferred）。 */
export const BROWSER_MCP_NAME = "browser";

/**
 * 登录态接入。
 * 默认 profile：有窗系统 Chrome / Edge（按探测）或钉版 Chromium + 专用 user-data-dir。
 * extension：可选，挂日常 Chrome/Edge（须手动装 Playwright MCP Bridge）。
 */
export type BrowserUseMode = "extension" | "profile";

/** 默认专用 profile：免装扩展、有窗可见、登录态养在 AgentUp 目录。 */
const DEFAULT_MODE: BrowserUseMode = "profile";

export type BrowserUseSettings = {
  mode: BrowserUseMode;
};

export function browserUseSettingsPath(userDataRoot: string): string {
  return path.join(userDataRoot, "runtime", "browser-use.json");
}

export function readBrowserUseSettings(userDataRoot: string): BrowserUseSettings {
  const file = browserUseSettingsPath(userDataRoot);
  if (!fs.existsSync(file)) return { mode: DEFAULT_MODE };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { mode?: unknown };
    return { mode: normalizeBrowserUseMode(parsed.mode) };
  } catch {
    return { mode: DEFAULT_MODE };
  }
}

export function writeBrowserUseSettings(
  userDataRoot: string,
  input: { mode: unknown },
): BrowserUseSettings {
  const settings: BrowserUseSettings = { mode: normalizeBrowserUseMode(input.mode) };
  const file = browserUseSettingsPath(userDataRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}

export function normalizeBrowserUseMode(value: unknown): BrowserUseMode {
  return value === "extension" ? "extension" : DEFAULT_MODE;
}

/**
 * 上游 @playwright/mcp 参数（含剧场 init-script）。
 * 不含 npx 的 `-y` / 包名：由 playwright-mcp-launch + 本地 cli.js 承接。
 */
export function browserUpstreamArgs(
  userDataRoot: string,
  host?: BrowserUseLaunchHost,
): string[] {
  const mode = readBrowserUseSettings(userDataRoot).mode;
  const theater = ensureBrowserTheaterAssets(userDataRoot);
  const initArgs = ["--init-script", theater.initScript];
  if (mode === "extension") {
    return ["--extension", ...initArgs];
  }
  const launch = resolveBrowserUseLaunch(userDataRoot, host);
  fs.mkdirSync(launch.profileDir, { recursive: true });
  return [...launch.mcpArgs, ...initArgs];
}

/** 解析当前 profile 模式选用的引擎（extension 模式不走探测）。 */
export function resolveBrowserUseProfileLaunch(
  userDataRoot: string,
  host?: BrowserUseLaunchHost,
): BrowserUseLaunch | null {
  if (readBrowserUseSettings(userDataRoot).mode === "extension") return null;
  return resolveBrowserUseLaunch(userDataRoot, host);
}

/**
 * 厂商 SDK / Pi 共用的 stdio MCP 形。
 * 经 mcp-bridge：真窗剧场 init-script + 动作前自动截图并入结果。
 * 设 `AGENTUP_BROWSER_USER_DATA_ROOT` → 连本机单例宿主（多会话共享一份 profile / 浏览器），
 * 避免并行会话抢同一 user-data-dir 报 already in use。
 * 上游：`execPath playwright-mcp-launch.js <userDataRoot> ...mcpArgs`（禁 npx/.cmd）。
 */
export function browserStdioConfig(
  userDataRoot: string,
  host?: BrowserUseLaunchHost,
): {
  command: string;
  args: string[];
  env: Record<string, string>;
  exposure: "deferred";
} {
  const theater = ensureBrowserTheaterAssets(userDataRoot);
  const launch = resolveBrowserUseProfileLaunch(userDataRoot, host);
  const upstreamArgs = [
    playwrightMcpLaunchPath(),
    userDataRoot,
    ...browserUpstreamArgs(userDataRoot, host),
  ];
  const env: Record<string, string> = {
    AGENTUP_BROWSER_USER_DATA_ROOT: userDataRoot,
    AGENTUP_BROWSER_UPSTREAM_COMMAND: process.execPath,
    AGENTUP_BROWSER_UPSTREAM_ARGS_JSON: JSON.stringify(upstreamArgs),
  };
  // 钉版 Chromium：与 headless playwright 共用 browsers 目录
  if (launch?.needsBundledChromium) {
    env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersDir(userDataRoot);
    env.AGENTUP_BROWSER_ENSURE_BROWSERS = "1";
  }
  return {
    command: process.execPath,
    args: [theater.bridge],
    env,
    exposure: "deferred",
  };
}

/** Pi LoadedMcpConfig 条目：平台注入，强制 deferred。 */
export function browserMcpEntry(
  userDataRoot: string,
  host?: BrowserUseLaunchHost,
): McpServerEntry {
  const stdio = browserStdioConfig(userDataRoot, host);
  return {
    name: BROWSER_MCP_NAME,
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

/** 合并平台 Browser Use：同名强制覆盖为 deferred 平台条目。 */
export function injectBrowserUseMcp<T extends { servers: McpServerEntry[] }>(
  config: T,
  userDataRoot: string,
  host?: BrowserUseLaunchHost,
): T {
  const entry = browserMcpEntry(userDataRoot, host);
  const servers = config.servers.filter((server) => server.name !== BROWSER_MCP_NAME);
  servers.push(entry);
  // 与 playwright 共用本地包；预热安装，bridge 重拉上游时 launch 仍会 ensure
  void ensurePlaywrightMcpInstalled(userDataRoot).catch(() => undefined);
  const launch = resolveBrowserUseProfileLaunch(userDataRoot, host);
  if (launch?.needsBundledChromium) {
    void ensurePlaywrightBrowsers(userDataRoot).catch(() => undefined);
  }
  return { ...config, servers };
}
