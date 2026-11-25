/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  isMenuBarPrefAvailable,
  readMenuBarVisible,
  writeMenuBarVisible,
} from "../../src/app/native/menu-bar-pref.js";

/** Node 无 --localstorage-file / happy-dom 未挂上时补内存 stub，否则 write 静默失败。 */
function ensureLocalStorage(): void {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
      localStorage.setItem("__agentup_probe__", "1");
      localStorage.removeItem("__agentup_probe__");
      return;
    }
  } catch {
    /* 继续 stub */
  }
  const store = new Map<string, string>();
  const stub = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key() {
      return null;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: stub,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      writable: true,
      value: stub,
    });
  }
}

beforeEach(() => {
  ensureLocalStorage();
});

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
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
