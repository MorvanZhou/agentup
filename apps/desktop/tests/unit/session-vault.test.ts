import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const { createSessionVault } = createRequire(import.meta.url)("../../electron/session-vault.cjs") as {
  createSessionVault: (deps: {
    safeStorage: {
      isEncryptionAvailable(): boolean;
      getSelectedStorageBackend?(): string;
      encryptString(value: string): Buffer;
      decryptString(value: Buffer): string;
    };
    userDataPath: string;
    fs: typeof import("node:fs/promises");
    path: typeof import("node:path");
  }) => {
    read(): Promise<{
      userId: string;
      email: string;
      nickname: string;
      token: string;
      hasAvatar?: boolean;
      avatarUrl?: string;
    } | null>;
    write(session: {
      userId: string;
      email: string;
      nickname: string;
      token: string;
      hasAvatar?: boolean;
      avatarUrl?: string;
    }): Promise<void>;
    clear(): Promise<void>;
    encryptionReady(): boolean;
  };
};

const fs = await import("node:fs/promises");
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function vault(backend = "keychain") {
  const userDataPath = await mkdtemp(path.join(tmpdir(), "agentup-session-"));
  dirs.push(userDataPath);
  const key = Buffer.from("test-key");
  return createSessionVault({
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => backend,
      encryptString: (value) => Buffer.concat([key, Buffer.from(value, "utf8")]),
      decryptString: (value) => value.subarray(key.length).toString("utf8"),
    },
    userDataPath,
    fs,
    path,
  });
}

it("把登录态加密写入 userData，并能读回", async () => {
  const store = await vault();
  await store.write({ userId: "u1", email: "alice@example.com", nickname: "alice", token: "tok" });
  const encoded = await readFile(path.join(dirs[0], "session.enc"), "utf8");
  expect(encoded).not.toContain("tok");
  expect(encoded).not.toContain("alice");
  await expect(store.read()).resolves.toEqual({ kind: "account", userId: "u1", email: "alice@example.com", nickname: "alice", token: "tok" });
});

it("读写保留账号头像字段", async () => {
  const store = await vault();
  const avatarUrl = "http://127.0.0.1:8787/statics/users/u1/avatar.webp?v=1";
  await store.write({
    userId: "u1",
    email: "alice@example.com",
    nickname: "alice",
    token: "tok",
    hasAvatar: true,
    avatarUrl,
  });
  await expect(store.read()).resolves.toEqual({
    kind: "account",
    userId: "u1",
    email: "alice@example.com",
    nickname: "alice",
    token: "tok",
    hasAvatar: true,
    avatarUrl,
  });
});

it("有 hasAvatar 但无 URL 时不写入伪头像", async () => {
  const store = await vault();
  await store.write({
    userId: "u1",
    email: "alice@example.com",
    nickname: "alice",
    token: "tok",
    hasAvatar: true,
  });
  await expect(store.read()).resolves.toEqual({
    kind: "account",
    userId: "u1",
    email: "alice@example.com",
    nickname: "alice",
    token: "tok",
    hasAvatar: true,
  });
});

it("basic_text 后端拒绝保存", async () => {
  const store = await vault("basic_text");
  expect(store.encryptionReady()).toBe(false);
  await expect(store.write({ userId: "u1", email: "alice@example.com", nickname: "alice", token: "tok" })).rejects.toThrow("无法安全保存");
  await expect(store.read()).resolves.toBeNull();
});

it("清除后读不到会话", async () => {
  const store = await vault();
  await store.write({ userId: "u2", email: "bob@example.com", nickname: "bob", token: "bye" });
  await store.clear();
  await expect(store.read()).resolves.toBeNull();
});
