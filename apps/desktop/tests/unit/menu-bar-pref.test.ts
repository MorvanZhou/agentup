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

/** 设置页只读 platform；补齐桥接必填方法，避免把残缺对象断言成完整 agentUp。 */
function stubAgentUp(platform: string): void {
  window.agentUp = {
    platform,
    readSession: async () => null,
    saveSession: async () => {},
    clearSession: async () => {},
    selectSkillPackage: async () => null,
    openVisitDirectory: async () => {},
    revealInFolder: async () => {},
    openPath: async () => {},
  };
}

it("only offers the menu bar preference on macOS Electron", () => {
  expect(isMenuBarPrefAvailable()).toBe(false);
  stubAgentUp("darwin");
  expect(isMenuBarPrefAvailable()).toBe(true);
  stubAgentUp("win32");
  expect(isMenuBarPrefAvailable()).toBe(false);
});
