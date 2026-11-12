import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  applyUiLocale,
  localeFromSystemLanguages,
  readDeviceLocale,
  resolveAccountLocaleOnLogin,
  resolveUiLocale,
  t,
  writeDeviceLocale,
} from "../../src/shared/model/ui/ui-locale.js";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, String(value));
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage(),
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("uses the device language while signed out", () => {
  expect(resolveUiLocale(true, "en", "zh")).toBe("en");
  expect(resolveUiLocale(true, "zh", "en")).toBe("zh");
});

it("uses the account language after sign-in", () => {
  expect(resolveUiLocale(false, "zh", "en")).toBe("en");
  expect(resolveUiLocale(false, "en", "zh")).toBe("zh");
});

it("maps zh / zh-CN / zh-TW / zh-HK system tags to zh", () => {
  expect(localeFromSystemLanguages(["zh"])).toBe("zh");
  expect(localeFromSystemLanguages(["zh-CN"])).toBe("zh");
  expect(localeFromSystemLanguages(["zh-TW", "en"])).toBe("zh");
  expect(localeFromSystemLanguages(["zh-HK"])).toBe("zh");
  expect(localeFromSystemLanguages(["zh-Hans-CN"])).toBe("zh");
});

it("maps non-Chinese system tags to en", () => {
  expect(localeFromSystemLanguages(["en-US"])).toBe("en");
  expect(localeFromSystemLanguages(["ja-JP"])).toBe("en");
  expect(localeFromSystemLanguages(["fr-FR", "de"])).toBe("en");
  expect(localeFromSystemLanguages([])).toBe("en");
});

it("keeps an existing agentup.locale and does not re-detect", () => {
  localStorage.setItem("agentup.locale", "en");
  vi.stubGlobal("navigator", { language: "zh-CN", languages: ["zh-CN"] });
  expect(readDeviceLocale()).toBe("en");
  expect(localStorage.getItem("agentup.locale")).toBe("en");
});

it("detects system language once when agentup.locale is missing and persists it", () => {
  vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US", "en"] });
  expect(readDeviceLocale()).toBe("en");
  expect(localStorage.getItem("agentup.locale")).toBe("en");

  vi.stubGlobal("navigator", { language: "zh-CN", languages: ["zh-CN"] });
  expect(readDeviceLocale()).toBe("en");
});

it("detects Chinese system language on first launch", () => {
  vi.stubGlobal("navigator", { language: "zh-TW", languages: ["zh-TW"] });
  expect(readDeviceLocale()).toBe("zh");
  expect(localStorage.getItem("agentup.locale")).toBe("zh");
});

it("seeds account locale from device when account still has factory zh and device is en", () => {
  expect(resolveAccountLocaleOnLogin("en", "zh")).toEqual({
    locale: "en",
    pushToAccount: true,
  });
});

it("keeps an existing account locale when it already differs from a Chinese device default", () => {
  expect(resolveAccountLocaleOnLogin("zh", "en")).toEqual({
    locale: "en",
    pushToAccount: false,
  });
  expect(resolveAccountLocaleOnLogin("zh", "zh")).toEqual({
    locale: "zh",
    pushToAccount: false,
  });
  expect(resolveAccountLocaleOnLogin("en", "en")).toEqual({
    locale: "en",
    pushToAccount: false,
  });
});

it("writeDeviceLocale persists explicit choice", () => {
  writeDeviceLocale("en");
  expect(localStorage.getItem("agentup.locale")).toBe("en");
  writeDeviceLocale("zh");
  expect(localStorage.getItem("agentup.locale")).toBe("zh");
});

it("keeps the Chinese browser sign-in label by default", async () => {
  await applyUiLocale("zh");
  expect(t("loginCardTitle")).toBe("继续登录");
});

it("loads English messages on demand", async () => {
  await applyUiLocale("en");
  expect(t("loginCardTitle")).toBe("Continue");
  await applyUiLocale("zh");
});
