import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  cursorAuthPath,
  cursorCredentialStore,
  readCursorApiKey,
} from "../src/session/external/sdk/adapters/cursor/credentials.js";

it("自管凭据 store 可读写清理，不依赖 SDK FileCredentialStore", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-cursor-cred-"));
  const templateId = "cursor-sdk";
  const store = cursorCredentialStore(root, templateId);
  expect(await store.load()).toBeNull();

  await store.save({
    version: 1,
    backendUrl: "https://api.cursor.com",
    apiKey: "key-abc",
    email: "a@b.com",
    createdAtMs: Date.now(),
    apiKeyExpiresAtMs: Date.now() + 60_000,
  });

  expect(fs.existsSync(cursorAuthPath(root, templateId))).toBe(true);
  expect(await readCursorApiKey(root, templateId)).toBe("key-abc");
  const loaded = await store.load();
  expect(loaded?.email).toBe("a@b.com");

  await store.clear();
  expect(await readCursorApiKey(root, templateId)).toBeNull();
});

it("过期 key 视为未登录并清掉文件", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-cursor-exp-"));
  const store = cursorCredentialStore(root, "cursor-sdk");
  await store.save({
    version: 1,
    backendUrl: "https://api.cursor.com",
    apiKey: "old",
    createdAtMs: Date.now() - 10_000,
    apiKeyExpiresAtMs: Date.now() - 1,
  });
  expect(await readCursorApiKey(root, "cursor-sdk")).toBeNull();
});
