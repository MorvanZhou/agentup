import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  browserUseCandidatePaths,
  browserUseProfileDir,
  normalizeBrowserPath,
  resolveBrowserUseLaunch,
  type BrowserUseLaunchHost,
} from "../src/session/mcp/browser-use-launch.js";

function hostWith(
  installed: string[],
  platform: NodeJS.Platform = "win32",
  env: NodeJS.ProcessEnv = {
    PROGRAMFILES: "C:\\Program Files",
    "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
  },
): BrowserUseLaunchHost {
  const set = new Set(installed.map((p) => normalizeBrowserPath(p, platform)));
  return {
    platform,
    env,
    existsSync: (p) => set.has(normalizeBrowserPath(p, platform)),
  };
}

describe("resolveBrowserUseLaunch", () => {
  it("Windows：有 Chrome 时优先 chrome，profile 沿用旧目录", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-browser-launch-"));
    const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    const launch = resolveBrowserUseLaunch(root, hostWith([chrome, edge], "win32"));
    expect(launch.engine).toBe("chrome");
    expect(launch.needsBundledChromium).toBe(false);
    expect(launch.profileDir).toBe(browserUseProfileDir(root, "chrome"));
    expect(launch.profileDir).toBe(path.join(root, "runtime", "browser-use-profile"));
    expect(launch.mcpArgs).toEqual(["--browser", "chrome", "--user-data-dir", launch.profileDir]);
  });

  it("Windows：无 Chrome 有 Edge 时回落 msedge，profile 分目录", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-browser-launch-"));
    const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    const launch = resolveBrowserUseLaunch(root, hostWith([edge], "win32"));
    expect(launch.engine).toBe("msedge");
    expect(launch.needsBundledChromium).toBe(false);
    expect(launch.profileDir).toBe(path.join(root, "runtime", "browser-use-profile-msedge"));
    expect(launch.mcpArgs).toEqual(["--browser", "msedge", "--user-data-dir", launch.profileDir]);
  });

  it("无系统 Chrome/Edge 时回落钉版 chromium，并声明需要 PLAYWRIGHT_BROWSERS_PATH", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-browser-launch-"));
    const launch = resolveBrowserUseLaunch(root, hostWith([], "win32"));
    expect(launch.engine).toBe("chromium");
    expect(launch.needsBundledChromium).toBe(true);
    expect(launch.profileDir).toBe(path.join(root, "runtime", "browser-use-profile-chromium"));
    expect(launch.mcpArgs).toEqual([
      "--browser",
      "chromium",
      "--user-data-dir",
      launch.profileDir,
    ]);
  });

  it("macOS：探测 Applications 下的 Chrome / Edge", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-browser-launch-"));
    const edge = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
    const launch = resolveBrowserUseLaunch(root, hostWith([edge], "darwin", {}));
    expect(launch.engine).toBe("msedge");
    expect(browserUseCandidatePaths("darwin", {}).chrome.length).toBeGreaterThan(0);
    expect(browserUseCandidatePaths("darwin", {}).msedge).toContain(edge);
  });
});
