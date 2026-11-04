import { expect, it } from "vitest";

import {
  busyState,
  canLogout,
  needsLogin,
  sdkReady,
  showDesktopMyth,
} from "../../src/pages/settings/components/sections/app-settings/provider-sdk/sdk-state";

it("sdkReady 只认 ready", () => {
  expect(sdkReady("ready")).toBe(true);
  expect(sdkReady("installed")).toBe(false);
});

it("needsLogin 覆盖已装未登与 error", () => {
  expect(needsLogin("installed")).toBe(true);
  expect(needsLogin("not_logged_in")).toBe(true);
  expect(needsLogin("error")).toBe(true);
  expect(needsLogin("not_installed")).toBe(false);
  expect(needsLogin("ready")).toBe(false);
});

it("busy / logout / desktopMyth 跟状态机分叉", () => {
  expect(busyState("installing")).toBe(true);
  expect(busyState("logging_in")).toBe(true);
  expect(canLogout("ready")).toBe(true);
  expect(canLogout("error")).toBe(true);
  expect(canLogout("not_logged_in")).toBe(false);
  expect(showDesktopMyth("not_installed")).toBe(true);
  expect(showDesktopMyth("install_failed")).toBe(true);
  expect(showDesktopMyth("ready")).toBe(false);
});
