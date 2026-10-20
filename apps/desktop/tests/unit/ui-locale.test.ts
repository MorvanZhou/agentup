import { expect, it } from "vitest";

import { applyUiLocale, resolveUiLocale, t } from "../../src/shared/model/ui-locale.js";

it("uses the device language while signed out", () => {
  expect(resolveUiLocale(true, "en", "zh")).toBe("en");
  expect(resolveUiLocale(true, "zh", "en")).toBe("zh");
});

it("uses the account language after sign-in", () => {
  expect(resolveUiLocale(false, "zh", "en")).toBe("en");
  expect(resolveUiLocale(false, "en", "zh")).toBe("zh");
});

it("keeps the Chinese browser sign-in label by default", async () => {
  await applyUiLocale("zh");
  expect(t("loginCta")).toBe("前往 agentup.me");
});

it("loads English messages on demand", async () => {
  await applyUiLocale("en");
  expect(t("loginCta")).toBe("Go to agentup.me");
  await applyUiLocale("zh");
});
