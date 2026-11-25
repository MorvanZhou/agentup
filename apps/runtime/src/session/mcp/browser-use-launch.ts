/**
 * 有窗 Browser Use：本机 Chrome → Edge → 钉版 Chromium。
 * 探测路径、不「起失败再试」；各引擎专用 profile，Chrome 沿用旧目录保登录态。
 */
import fs from "node:fs";
import path from "node:path";

/** Playwright MCP `--browser` 通道：系统 Chrome / Edge，或自带 chromium。 */
export type BrowserUseEngine = "chrome" | "msedge" | "chromium";

export type BrowserUseLaunch = {
  engine: BrowserUseEngine;
  /** 写入上游 mcp args 的片段（不含 init-script）。 */
  mcpArgs: string[];
  profileDir: string;
  /** 真时须带 PLAYWRIGHT_BROWSERS_PATH，并 ensurePlaywrightBrowsers。 */
  needsBundledChromium: boolean;
};

export type BrowserUseLaunchHost = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  existsSync: (filePath: string) => boolean;
};

const DEFAULT_HOST: BrowserUseLaunchHost = {
  platform: process.platform,
  env: process.env,
  existsSync: (filePath) => fs.existsSync(filePath),
};

/** Chrome 沿用历史目录；Edge / Chromium 分目录，避免混 user-data。 */
export function browserUseProfileDir(
  userDataRoot: string,
  engine: BrowserUseEngine = "chrome",
): string {
  if (engine === "chrome") {
    return path.join(userDataRoot, "runtime", "browser-use-profile");
  }
  return path.join(userDataRoot, "runtime", `browser-use-profile-${engine}`);
}

/** 按目标 platform 拼路径（测例可在 darwin 上模拟 win32）。 */
function joinFor(platform: NodeJS.Platform, ...parts: string[]): string {
  return (platform === "win32" ? path.win32 : path.posix).join(...parts);
}

/** 比较用：统一分隔符，避免 win32 路径在 posix 宿主上对不上。 */
export function normalizeBrowserPath(filePath: string, platform: NodeJS.Platform): string {
  return (platform === "win32" ? path.win32 : path.posix).normalize(filePath);
}

/** 各平台候选可执行文件（仅探测存在，不启动）。 */
export function browserUseCandidatePaths(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): { chrome: string[]; msedge: string[] } {
  if (platform === "win32") {
    const programFiles = env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 = env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const localAppData = env.LOCALAPPDATA || "";
    const chrome = [
      joinFor(platform, programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      joinFor(platform, programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      ...(localAppData
        ? [joinFor(platform, localAppData, "Google", "Chrome", "Application", "chrome.exe")]
        : []),
    ];
    const msedge = [
      joinFor(platform, programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      joinFor(platform, programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    ];
    return { chrome, msedge };
  }
  if (platform === "darwin") {
    return {
      chrome: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
      msedge: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
    };
  }
  // linux：只认 Google Chrome / Edge 渠道；系统 chromium 走钉版回落
  return {
    chrome: ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"],
    msedge: ["/usr/bin/microsoft-edge-stable", "/usr/bin/microsoft-edge"],
  };
}

function firstExisting(
  candidates: string[],
  existsSync: (filePath: string) => boolean,
  platform: NodeJS.Platform,
): string | undefined {
  for (const candidate of candidates) {
    if (existsSync(normalizeBrowserPath(candidate, platform))) return candidate;
  }
  return undefined;
}

/**
 * 解析有窗 Browser Use 实际引擎。
 * 顺序：本机 Chrome → 本机 Edge → 钉版 Chromium（由 playwright install 提供）。
 */
export function resolveBrowserUseLaunch(
  userDataRoot: string,
  host: BrowserUseLaunchHost = DEFAULT_HOST,
): BrowserUseLaunch {
  const candidates = browserUseCandidatePaths(host.platform, host.env);
  const exists = (filePath: string) =>
    host.existsSync(normalizeBrowserPath(filePath, host.platform));
  if (firstExisting(candidates.chrome, exists, host.platform)) {
    const profileDir = browserUseProfileDir(userDataRoot, "chrome");
    return {
      engine: "chrome",
      profileDir,
      needsBundledChromium: false,
      mcpArgs: ["--browser", "chrome", "--user-data-dir", profileDir],
    };
  }
  if (firstExisting(candidates.msedge, exists, host.platform)) {
    const profileDir = browserUseProfileDir(userDataRoot, "msedge");
    return {
      engine: "msedge",
      profileDir,
      needsBundledChromium: false,
      mcpArgs: ["--browser", "msedge", "--user-data-dir", profileDir],
    };
  }
  const profileDir = browserUseProfileDir(userDataRoot, "chromium");
  return {
    engine: "chromium",
    profileDir,
    needsBundledChromium: true,
    mcpArgs: ["--browser", "chromium", "--user-data-dir", profileDir],
  };
}
