import { createRequire } from "node:module";
import { expect, it } from "vitest";

const {
  parseUpdateYml,
  compareVersions,
  isNewerVersion,
  resolveUpdateFeedUrl,
  pickManualInstallFile,
  resolveDownloadUrl,
  checkForAppUpdate,
} = createRequire(import.meta.url)("../../electron/app-update.cjs") as {
  parseUpdateYml(text: string): {
    version: string;
    files: Array<{ url: string; sha512: string; size?: number }>;
    path: string;
    sha512: string;
  };
  compareVersions(a: string, b: string): number;
  isNewerVersion(remote: string, current: string): boolean;
  resolveUpdateFeedUrl(downloadsBase: string, platform: string): string;
  pickManualInstallFile(
    info: { files: Array<{ url: string; sha512: string; size?: number }>; path: string; sha512: string },
    platform: string,
  ): { url: string; sha512: string; size?: number };
  resolveDownloadUrl(downloadsBase: string, platform: string, fileUrl: string): string;
  checkForAppUpdate(opts: {
    downloadsBase: string;
    platform: string;
    currentVersion: string;
    fetchText?: (url: string) => Promise<string>;
  }): Promise<{
    updateAvailable: boolean;
    latestVersion: string;
    downloadUrl: string;
  }>;
};

const SAMPLE_MAC = [
  "version: 0.2.0",
  "files:",
  "  - url: AgentUp-arm64-mac.zip",
  "    sha512: AAA",
  "    size: 10",
  "  - url: AgentUp-arm64.dmg",
  "    sha512: BBB",
  "    size: 20",
  "path: AgentUp-arm64-mac.zip",
  "sha512: AAA",
  "releaseDate: '2026-10-29T04:00:00.000Z'",
  "",
].join("\n");

it("解析 electron-updater 风格 latest-mac.yml", () => {
  expect(parseUpdateYml(SAMPLE_MAC)).toEqual({
    version: "0.2.0",
    files: [
      { url: "AgentUp-arm64-mac.zip", sha512: "AAA", size: 10 },
      { url: "AgentUp-arm64.dmg", sha512: "BBB", size: 20 },
    ],
    path: "AgentUp-arm64-mac.zip",
    sha512: "AAA",
  });
});

it("比较版本号", () => {
  expect(compareVersions("0.2.0", "0.1.8")).toBeGreaterThan(0);
  expect(compareVersions("0.1.8", "0.1.8")).toBe(0);
  expect(compareVersions("0.1.7", "0.1.8")).toBeLessThan(0);
  expect(isNewerVersion("0.2.0", "0.1.8")).toBe(true);
  expect(isNewerVersion("0.1.8", "0.1.8")).toBe(false);
  expect(isNewerVersion("0.1.7", "0.1.8")).toBe(false);
});

it("按平台解析 feed 与手动安装包（mac 优先 dmg）", () => {
  const base = "https://downloads.agentup.me";
  expect(resolveUpdateFeedUrl(base, "darwin")).toBe(
    "https://downloads.agentup.me/desktop/mac/latest/latest-mac.yml",
  );
  expect(resolveUpdateFeedUrl(base, "win32")).toBe(
    "https://downloads.agentup.me/desktop/win/latest/latest.yml",
  );
  const mac = pickManualInstallFile(parseUpdateYml(SAMPLE_MAC), "darwin");
  expect(mac.url).toBe("AgentUp-arm64.dmg");
  expect(mac.sha512).toBe("BBB");
  expect(resolveDownloadUrl(base, "darwin", mac.url)).toBe(
    "https://downloads.agentup.me/desktop/mac/latest/AgentUp-arm64.dmg",
  );
});

it("checkForAppUpdate 在远端更高时标记可更新", async () => {
  const result = await checkForAppUpdate({
    downloadsBase: "https://downloads.agentup.me",
    platform: "darwin",
    currentVersion: "0.1.8",
    fetchText: async () => SAMPLE_MAC,
  });
  expect(result).toMatchObject({
    updateAvailable: true,
    latestVersion: "0.2.0",
    downloadUrl: "https://downloads.agentup.me/desktop/mac/latest/AgentUp-arm64.dmg",
  });
});
