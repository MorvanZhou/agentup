/**
 * @vitest-environment happy-dom
 */
import { afterEach, expect, it } from "vitest";

import {
  isMenuBarPrefAvailable,
  readMenuBarVisible,
  writeMenuBarVisible,
} from "../../src/app/native/menu-bar-pref.js";

afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, "agentUp");
});

it("defaults menu bar visibility to on when unset", () => {
  expect(readMenuBarVisible()).toBe(true);
});

it("persists menu bar visibility on this device", () => {
  writeMenuBarVisible(false);
  expect(readMenuBarVisible()).toBe(false);
  writeMenuBarVisible(true);
  expect(readMenuBarVisible()).toBe(true);
});

it("only offers the menu bar preference on macOS Electron", () => {
  expect(isMenuBarPrefAvailable()).toBe(false);
  window.agentUp = { platform: "darwin" };
  expect(isMenuBarPrefAvailable()).toBe(true);
  window.agentUp = { platform: "win32" };
  expect(isMenuBarPrefAvailable()).toBe(false);
});
