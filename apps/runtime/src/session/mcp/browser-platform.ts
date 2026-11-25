import fs from "node:fs";
import path from "node:path";

import type { McpServerEntry } from "@earendil-works/pi-coding-agent";

import { ensureBrowserTheaterAssets } from "./browser-theater/ensure-assets.js";
import {
  ensurePlaywrightMcpInstalled,
  playwrightMcpLaunchPath,
} from "./playwright-platform.js";

/** 平台 Browser Use MCP 名（外站登录态；强制 deferred）。 */
export const BROWSER_MCP_NAME = "browser";

/**
 * 登录态接入。
 * 默认 profile：有窗 Chrome + 专用 user-data-dir（对齐反爬方法论第 6 层，无需扩展）。
 * extension：可选，挂日常 Chrome（须手动装 Playwright MCP Bridge）。
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

/** 专用 profile；永不指向日常 Chrome User Data。 */
export function browserUseProfileDir(userDataRoot: string): string {
  return path.join(userDataRoot, "runtime", "browser-use-profile");
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
export function browserUpstreamArgs(userDataRoot: string): string[] {
  const mode = readBrowserUseSettings(userDataRoot).mode;
  const theater = ensureBrowserTheaterAssets(userDataRoot);
  const initArgs = ["--init-script", theater.initScript];
  if (mode === "extension") {
    return ["--extension", ...initArgs];
  }
  const profile = browserUseProfileDir(userDataRoot);
  fs.mkdirSync(profile, { recursive: true });
  return ["--browser", "chrome", "--user-data-dir", profile, ...initArgs];
}

/**
 * 厂商 SDK / Pi 共用的 stdio MCP 形。
 * 经 mcp-bridge：真窗剧场 init-script + 动作后自动截图并入结果。
 * 上游：`execPath playwright-mcp-launch.js <userDataRoot> ...mcpArgs`（禁 npx/.cmd）。
 */
export function browserStdioConfig(userDataRoot: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
  exposure: "deferred";
} {
  const theater = ensureBrowserTheaterAssets(userDataRoot);
  const upstreamArgs = [
    playwrightMcpLaunchPath(),
    userDataRoot,
    ...browserUpstreamArgs(userDataRoot),
  ];
  return {
    command: process.execPath,
    args: [theater.bridge],
    env: {
      AGENTUP_BROWSER_UPSTREAM_COMMAND: process.execPath,
      AGENTUP_BROWSER_UPSTREAM_ARGS_JSON: JSON.stringify(upstreamArgs),
    },
    exposure: "deferred",
  };
}

/** Pi LoadedMcpConfig 条目：平台注入，强制 deferred。 */
export function browserMcpEntry(userDataRoot: string): McpServerEntry {
  const stdio = browserStdioConfig(userDataRoot);
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
): T {
  const entry = browserMcpEntry(userDataRoot);
  const servers = config.servers.filter((server) => server.name !== BROWSER_MCP_NAME);
  servers.push(entry);
  // 与 playwright 共用本地包；预热安装，bridge 重拉上游时 launch 仍会 ensure
  void ensurePlaywrightMcpInstalled(userDataRoot).catch(() => undefined);
  return { ...config, servers };
}
