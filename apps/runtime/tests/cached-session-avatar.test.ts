import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { materializeSessionAvatar } from "../src/local/user/cached-session-avatar.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-session-avatar-"));
  roots.push(root);
  return root;
}

function tinyWebp(): Buffer {
  const buf = Buffer.alloc(12);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(4, 4);
  buf.write("WEBP", 8);
  return buf;
}

it("materializeSessionAvatar writes data url and survives expired signed remote", async () => {
  const root = tempRoot();
  const bytes = tinyWebp();
  const signed =
    "https://files.example/prod/avatars/users/uAlice/1.webp?q-sign-time=1;2&q-signature=dead";
  let fetches = 0;
  const fetchImpl: typeof fetch = async () => {
    fetches += 1;
    if (fetches === 1) {
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { "content-type": "image/webp" },
      });
    }
    return new Response("forbidden", { status: 403 });
  };

  const first = await materializeSessionAvatar(
    root,
    {
      userId: "uAlice",
      email: "a@example.com",
      nickname: "alice",
      token: "tok",
      hasAvatar: true,
      avatarUrl: signed,
    },
    { refresh: true, fetch: fetchImpl },
  );
  expect(first.avatarUrl?.startsWith("data:image/webp;base64,")).toBe(true);
  expect(fs.existsSync(path.join(root, "users/uAlice/account/assets/avatar.webp"))).toBe(true);

  const second = await materializeSessionAvatar(
    root,
    {
      userId: "uAlice",
      email: "a@example.com",
      nickname: "alice",
      token: "tok",
      hasAvatar: true,
      avatarUrl: `${signed}&rotated=1`,
    },
    { refresh: true, fetch: fetchImpl },
  );
  expect(fetches).toBe(2);
  expect(second.avatarUrl).toBe(first.avatarUrl);
});
