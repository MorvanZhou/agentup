import { afterEach, beforeEach, expect, it } from "vitest";

import {
  clearSession,
  ensureGuestSession,
  readSession,
  resetSessionStore,
  restoreSession,
  saveSession,
} from "../../src/app/session/session-store.js";
import { GUEST_SESSION } from "../../src/shared/model/session/session.js";

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
  Object.defineProperty(globalThis, "sessionStorage", { value: memoryStorage(), configurable: true });
  Object.defineProperty(globalThis, "window", {
    value: { agentUp: undefined as Window["agentUp"] },
    configurable: true,
  });
  resetSessionStore();
});

afterEach(async () => {
  await clearSession();
  resetSessionStore();
});

it("无 Electron 桥时用 localStorage 记住登录态", async () => {
  await saveSession({ userId: "u1", email: "alice@example.com", nickname: "alice", token: "tok" });
  expect(readSession()).toEqual({ kind: "account", userId: "u1", email: "alice@example.com", nickname: "alice", token: "tok" });
  expect(localStorage.getItem("agentup.session")).toContain("alice");

  await saveSession({
    userId: "u1",
    email: "alice@example.com",
    nickname: "alice",
    token: "tok",
    hasAvatar: true,
    avatarUrl: "http://127.0.0.1:8787/statics/users/u1/avatar.webp?v=1",
  });
  expect(readSession()).toEqual({
    kind: "account",
    userId: "u1",
    email: "alice@example.com",
    nickname: "alice",
    token: "tok",
    hasAvatar: true,
    avatarUrl: "http://127.0.0.1:8787/statics/users/u1/avatar.webp?v=1",
  });
});

it("有 safeStorage 桥时经 IPC 读写，并清掉旧 localStorage", async () => {
  let vault: { userId: string; email: string; nickname: string; token: string } | null = null;
  window.agentUp = {
    readSession: async () => vault,
    saveSession: async (session) => {
      vault = session;
    },
    clearSession: async () => {
      vault = null;
    },
    selectSkillPackage: async () => null,
    platform: "darwin",
    openVisitDirectory: async () => undefined,
    revealInFolder: async () => undefined,
    openPath: async () => undefined,
    setThemeSource: async () => undefined,
  };
  localStorage.setItem("agentup.session", JSON.stringify({ userId: "old", email: "old@example.com", nickname: "old", token: "old" }));

  await saveSession({ userId: "u2", email: "bob@example.com", nickname: "bob", token: "secure" });
  expect(vault).toEqual({ kind: "account", userId: "u2", email: "bob@example.com", nickname: "bob", token: "secure" });
  expect(localStorage.getItem("agentup.session")).toBeNull();
  expect(readSession()).toEqual({ kind: "account", userId: "u2", email: "bob@example.com", nickname: "bob", token: "secure" });
});

it("clearSession 后 ensureGuestSession 强制落回游客，不沿用账号", async () => {
  await saveSession({
    kind: "account",
    userId: "patient-a",
    email: "patient-a@example.com",
    nickname: "patient-a",
    token: "tok",
  });
  await clearSession();
  expect(readSession()).toBeNull();
  await expect(ensureGuestSession()).resolves.toEqual(GUEST_SESSION);
  expect(readSession()).toEqual(GUEST_SESSION);
});

it("首次 restore 会把旧 localStorage 迁进 safeStorage 桥", async () => {
  let vault: { userId: string; email: string; nickname: string; token: string } | null = null;
  window.agentUp = {
    readSession: async () => vault,
    saveSession: async (session) => {
      vault = session;
    },
    clearSession: async () => {
      vault = null;
    },
    selectSkillPackage: async () => null,
    platform: "darwin",
    openVisitDirectory: async () => undefined,
    revealInFolder: async () => undefined,
    openPath: async () => undefined,
    setThemeSource: async () => undefined,
  };
  localStorage.setItem("agentup.session", JSON.stringify({ userId: "u3", email: "carol@example.com", nickname: "carol", token: "legacy" }));

  await expect(restoreSession()).resolves.toEqual({ kind: "account", userId: "u3", email: "carol@example.com", nickname: "carol", token: "legacy" });
  expect(vault).toEqual({ kind: "account", userId: "u3", email: "carol@example.com", nickname: "carol", token: "legacy" });
  expect(localStorage.getItem("agentup.session")).toBeNull();
  expect(readSession()).toEqual({ kind: "account", userId: "u3", email: "carol@example.com", nickname: "carol", token: "legacy" });
});
