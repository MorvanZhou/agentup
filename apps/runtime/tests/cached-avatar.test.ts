import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  ensureCachedAvatar,
  readCachedAvatarDataUrl,
  writeCachedAvatarDataUrl,
} from "../src/local/agents/cached-avatar.js";

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
  const remote = "https://example.test/statics/agents/Weaty01/avatar.webp?v=1";
  let fetches = 0;
  const fetchImpl: typeof fetch = async (input) => {
    fetches += 1;
    expect(String(input)).toBe(remote);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "content-type": "image/webp" },
    });
  };

  const first = await ensureCachedAvatar(root, "guest", "Weaty01", remote, fetchImpl);
  expect(first?.startsWith("data:image/webp;base64,")).toBe(true);
  expect(fs.existsSync(path.join(root, "users/guest/agents/Weaty01/assets/avatar.webp"))).toBe(true);

  const second = await ensureCachedAvatar(root, "guest", "Weaty01", remote, fetchImpl);
  expect(second).toBe(first);
  expect(fetches).toBe(1);
  expect(readCachedAvatarDataUrl(root, "guest", "Weaty01")).toBe(first);
});

it("refetches unversioned remote url even when source.url matches", async () => {
  const root = tempRoot();
  const firstBytes = tinyWebp();
  const newer = Buffer.concat([tinyWebp(), Buffer.from([1, 2, 3, 4])]);
  const remote = "https://example.test/statics/agents/Weaty01/avatar.webp";
  const bodies = [firstBytes, newer];
  let fetches = 0;
  const fetchImpl: typeof fetch = async () => {
    const index = fetches;
    fetches += 1;
    return new Response(new Uint8Array(bodies[index]!), {
      status: 200,
      headers: { "content-type": "image/webp" },
    });
  };

  const first = await ensureCachedAvatar(root, "guest", "Weaty01", remote, fetchImpl);
  const second = await ensureCachedAvatar(root, "guest", "Weaty01", remote, fetchImpl);
  expect(fetches).toBe(2);
  expect(second).not.toBe(first);
  expect(readCachedAvatarDataUrl(root, "guest", "Weaty01")).toBe(second);
});

it("refetches when remote avatar url version changes", async () => {
  const root = tempRoot();
  const firstBytes = tinyWebp();
  const newer = Buffer.concat([tinyWebp(), Buffer.from([1, 2, 3, 4])]);
  const urls = [
    "https://example.test/statics/agents/Weaty01/avatar.webp?v=1",
    "https://example.test/statics/agents/Weaty01/avatar.webp?v=2",
  ];
  const bodies = [firstBytes, newer];
  let fetches = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const index = urls.indexOf(String(input));
    expect(index).toBeGreaterThanOrEqual(0);
    fetches += 1;
    return new Response(new Uint8Array(bodies[index]!), {
      status: 200,
      headers: { "content-type": "image/webp" },
    });
  };

  const first = await ensureCachedAvatar(root, "guest", "Weaty01", urls[0], fetchImpl);
  const second = await ensureCachedAvatar(root, "guest", "Weaty01", urls[1], fetchImpl);
  expect(fetches).toBe(2);
  expect(second).not.toBe(first);
  expect(second?.startsWith("data:image/webp;base64,")).toBe(true);
  expect(readCachedAvatarDataUrl(root, "guest", "Weaty01")).toBe(second);
});

it("writeCachedAvatarDataUrl overwrites stale disk cache", () => {
  const root = tempRoot();
  const oldUrl = `data:image/webp;base64,${tinyWebp().toString("base64")}`;
  const newer = Buffer.concat([tinyWebp(), Buffer.from([9, 9])]);
  const newUrl = `data:image/webp;base64,${newer.toString("base64")}`;

  expect(writeCachedAvatarDataUrl(root, "owner", "Weaty01", oldUrl)).toBe(oldUrl);
  expect(writeCachedAvatarDataUrl(root, "owner", "Weaty01", newUrl, "https://x/a.webp?v=9")).toBe(newUrl);
  expect(readCachedAvatarDataUrl(root, "owner", "Weaty01")).toBe(newUrl);
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
