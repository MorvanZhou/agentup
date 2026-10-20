import { beforeEach, expect, it } from "vitest";

import {
  rememberSkipClearContextConfirm,
  shouldSkipClearContextConfirm,
} from "../../src/pages/conversation/model/clear-context-confirm.js";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true });
});

it("defaults to showing the confirm dialog", () => {
  expect(shouldSkipClearContextConfirm("patient-a")).toBe(false);
  expect(shouldSkipClearContextConfirm("")).toBe(false);
});

it("remembers skip only for the same userId", () => {
  rememberSkipClearContextConfirm("patient-a");
  expect(shouldSkipClearContextConfirm("patient-a")).toBe(true);
  expect(shouldSkipClearContextConfirm("patient-b")).toBe(false);
});

it("ignores corrupt localStorage values", () => {
  localStorage.setItem("agentup.clearContext.skipConfirm", "{");
  expect(shouldSkipClearContextConfirm("patient-a")).toBe(false);
});
