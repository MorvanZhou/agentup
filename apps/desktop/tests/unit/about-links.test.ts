import { expect, it } from "vitest";

import {
  buildAboutMarketingUrls,
  reduceAboutUpdateResult,
  supportsAppUpdateCheck,
} from "../../src/pages/settings/model/about-links";

it("按 UI locale 拼官网与下载页（en 无前缀 / zh 有 /zh）", () => {
  expect(buildAboutMarketingUrls("https://agentup.me", "en")).toEqual({
    websiteUrl: "https://agentup.me",
    downloadPageUrl: "https://agentup.me/download",
  });
  expect(buildAboutMarketingUrls("https://agentup.me/", "zh")).toEqual({
    websiteUrl: "https://agentup.me/zh",
    downloadPageUrl: "https://agentup.me/zh/download",
  });
});

it("仅 darwin / win32 支持应用内检查更新", () => {
  expect(supportsAppUpdateCheck("darwin")).toBe(true);
  expect(supportsAppUpdateCheck("win32")).toBe(true);
  expect(supportsAppUpdateCheck("linux")).toBe(false);
  expect(supportsAppUpdateCheck(undefined)).toBe(false);
});

it("把更新检查结果收成页内状态", () => {
  expect(reduceAboutUpdateResult({ status: "checking" })).toEqual({ kind: "checking" });
  expect(reduceAboutUpdateResult({ status: "up-to-date" })).toEqual({ kind: "up-to-date" });
  expect(reduceAboutUpdateResult({ status: "error" })).toEqual({ kind: "error" });
  expect(
    reduceAboutUpdateResult({
      status: "available",
      latestVersion: "0.2.0",
      downloadUrl: "https://downloads.agentup.me/x.dmg",
    }),
  ).toEqual({
    kind: "available",
    latestVersion: "0.2.0",
    downloadUrl: "https://downloads.agentup.me/x.dmg",
  });
  expect(reduceAboutUpdateResult({ status: "available", latestVersion: "0.2.0" })).toBeNull();
  expect(reduceAboutUpdateResult({ status: "unknown" })).toBeNull();
});
