import { expect, it } from "vitest";

import {
  showBrowserOauthHint,
  showCancelInstall,
} from "../../src/pages/settings/components/sections/app-settings/provider-sdk/sdk-state";

it("浏览器提示只在 logging_in，安装中不显示", () => {
  expect(
    showBrowserOauthHint("logging_in", {
      installPhase: false,
      loginNeedsApiKey: false,
      modelsBusy: false,
    }),
  ).toBe(true);
  expect(
    showBrowserOauthHint("installing", {
      installPhase: true,
      loginNeedsApiKey: false,
      modelsBusy: false,
    }),
  ).toBe(false);
  expect(
    showBrowserOauthHint("installing", {
      installPhase: false,
      loginNeedsApiKey: false,
      modelsBusy: false,
    }),
  ).toBe(false);
  expect(
    showBrowserOauthHint("logging_in", {
      installPhase: false,
      loginNeedsApiKey: true,
      modelsBusy: false,
    }),
  ).toBe(false);
});

it("取消接入：有 installPhase 或卡在 installing", () => {
  expect(showCancelInstall("installing", true)).toBe(true);
  expect(showCancelInstall("installing", false)).toBe(true);
  expect(showCancelInstall("logging_in", false)).toBe(false);
  expect(showCancelInstall("not_installed", false)).toBe(false);
  expect(showCancelInstall("not_logged_in", true)).toBe(true);
});
