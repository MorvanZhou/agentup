import { expect, it } from "vitest";

import { localeFromRequest, normalizeLocale, t } from "../src/i18n/index.js";
import { en } from "../src/i18n/locales/en.js";
import { zh } from "../src/i18n/locales/zh.js";

it("keeps zh and en catalogs in key parity", () => {
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
});

it("falls back to zh then key", () => {
  expect(t("pa.defaultName", "zh")).toBe("小A");
  expect(t("pa.defaultName", "en")).toBe("Ace");
  expect(t("missing.key", "en")).toBe("missing.key");
});

it("normalizes request locale", () => {
  expect(normalizeLocale("en-US")).toBe("en");
  expect(normalizeLocale("zh-CN")).toBe("zh");
  expect(localeFromRequest("en", "zh")).toBe("en");
  expect(localeFromRequest(undefined, "en")).toBe("en");
  expect(localeFromRequest(undefined, undefined)).toBe("zh");
});
