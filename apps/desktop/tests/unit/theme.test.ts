import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  applyTheme,
  bootstrapTheme,
  clearThemeMirror,
  readThemeMirror,
  resolveTheme,
  systemPrefersDark,
  writeThemeMirror,
} from "../../src/app/theme.js";

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
  const classList = new Set<string>();
  Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true });
  Object.defineProperty(globalThis, "document", {
    value: {
      documentElement: {
        classList: {
          toggle(name: string, force?: boolean) {
            if (force) classList.add(name);
            else classList.delete(name);
          },
          contains(name: string) {
            return classList.has(name);
          },
        },
        style: { colorScheme: "" },
      },
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: {
      matchMedia: () => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    },
    configurable: true,
  });
});

afterEach(() => {
  clearThemeMirror();
});

it("resolves system mode from prefers-color-scheme", () => {
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("system", false)).toBe("light");
});

it("reads system preference from Electron bridge when present", () => {
  Object.defineProperty(globalThis, "window", {
    value: {
      agentUp: { systemPrefersDark: () => true },
      matchMedia: () => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    },
    configurable: true,
  });
  expect(systemPrefersDark()).toBe(true);
});

it("mirrors theme per user id", () => {
  writeThemeMirror("alice", "dark");
  expect(readThemeMirror("alice")).toBe("dark");
  expect(readThemeMirror("bob")).toBeNull();
  expect(readThemeMirror()).toBe("dark");
});

it("applies dark class and color-scheme on the document", () => {
  applyTheme("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe("dark");
  applyTheme("light");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(document.documentElement.style.colorScheme).toBe("light");
});

it("bootstraps from mirror when user id matches", () => {
  writeThemeMirror("alice", "dark");
  expect(bootstrapTheme("alice")).toBe("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(bootstrapTheme(null)).toBe("system");
});
