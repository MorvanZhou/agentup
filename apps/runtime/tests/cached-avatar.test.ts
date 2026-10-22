import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { ensureCachedAvatar, readCachedAvatarDataUrl } from "../src/local/cached-avatar.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-cached-avatar-"));
  roots.push(root);
  return root;
}

/** 最小合法 WebP：RIFF....WEBP */
function tinyWebp(): Buffer {
  const buf = Buffer.alloc(12);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(4, 4);
  buf.write("WEBP", 8);
  return buf;
}

it("caches remote avatar and serves data url offline", async () => {
  const root = tempRoot();
  const bytes = tinyWebp();
  const remote = "https://example.test/statics/agents/Weaty01/avatar.webp";
  const fetchImpl: typeof fetch = async (input) => {
    expect(String(input)).toBe(remote);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "content-type": "image/webp" },
    });
  };

  const first = await ensureCachedAvatar(root, "guest", "Weaty01", remote, fetchImpl);
  expect(first?.startsWith("data:image/webp;base64,")).toBe(true);
  expect(fs.existsSync(path.join(root, "users/guest/agents/Weaty01/assets/avatar.webp"))).toBe(true);

  const second = await ensureCachedAvatar(root, "guest", "Weaty01", "https://should-not-fetch", fetchImpl);
  expect(second).toBe(first);
  expect(readCachedAvatarDataUrl(root, "guest", "Weaty01")).toBe(first);
});

it("skips loc-* agents", async () => {
  const root = tempRoot();
  const result = await ensureCachedAvatar(
    root,
    "guest",
    "loc-abcd1234ef",
    "https://example.test/a.webp",
    async () =>
      new Response(new Uint8Array(tinyWebp()), {
        status: 200,
        headers: { "content-type": "image/webp" },
      }),
  );
  expect(result).toBeUndefined();
  expect(readCachedAvatarDataUrl(root, "guest", "loc-abcd1234ef")).toBeUndefined();
});
