import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  avatarCacheKey,
  ensureCachedAvatar,
  ensureCachedUserAvatar,
  readCachedAvatarDataUrl,
  readCachedUserAvatarDataUrl,
  writeCachedAvatarDataUrl,
  writeCachedUserAvatarDataUrl,
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

it("avatarCacheKey drops signing query and keeps ?v=", () => {
  expect(
    avatarCacheKey(
      "https://files.example/prod/avatars/users/u1/1.webp?q-sign-time=1;2&q-signature=abc",
    ),
  ).toBe("/prod/avatars/users/u1/1.webp");
  expect(avatarCacheKey("https://cdn.example/a.webp?v=3&q-sign=x")).toBe("/a.webp?v=3");
});

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

  const first = await ensureCachedAvatar(root, "guest", "Weaty01", remote, { fetch: fetchImpl });
  expect(first?.startsWith("data:image/webp;base64,")).toBe(true);
  expect(fs.existsSync(path.join(root, "users/guest/agents/Weaty01/assets/avatar.webp"))).toBe(true);

  const second = await ensureCachedAvatar(root, "guest", "Weaty01", remote, { fetch: fetchImpl });
  expect(second).toBe(first);
  expect(fetches).toBe(1);
  expect(readCachedAvatarDataUrl(root, "guest", "Weaty01")).toBe(first);
});

it("reuses cache when only COS signature query changes", async () => {
  const root = tempRoot();
  const bytes = tinyWebp();
  const firstUrl = "https://files.example/prod/avatars/agents/Weaty01/1.webp?q-sign-time=1;2&q-signature=a";
  const secondUrl = "https://files.example/prod/avatars/agents/Weaty01/1.webp?q-sign-time=9;10&q-signature=b";
  let fetches = 0;
  const fetchImpl: typeof fetch = async () => {
    fetches += 1;
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "content-type": "image/webp" },
    });
  };

  const first = await ensureCachedAvatar(root, "guest", "Weaty01", firstUrl, { fetch: fetchImpl });
  const second = await ensureCachedAvatar(root, "guest", "Weaty01", secondUrl, { fetch: fetchImpl });
  expect(fetches).toBe(1);
  expect(second).toBe(first);
});

it("refresh=true refetches even when cache identity matches", async () => {
  const root = tempRoot();
  const firstBytes = tinyWebp();
  const newer = Buffer.concat([tinyWebp(), Buffer.from([1, 2, 3, 4])]);
  const remote = "https://files.example/prod/avatars/agents/Weaty01/1.webp?q-sign=old";
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

  const first = await ensureCachedAvatar(root, "guest", "Weaty01", remote, { fetch: fetchImpl });
  const second = await ensureCachedAvatar(root, "guest", "Weaty01", remote, {
    fetch: fetchImpl,
    refresh: true,
  });
  expect(fetches).toBe(2);
  expect(second).not.toBe(first);
  expect(readCachedAvatarDataUrl(root, "guest", "Weaty01")).toBe(second);
});

it("falls back to disk cache when signed remote returns 403", async () => {
  const root = tempRoot();
  const remote = "https://files.example/prod/avatars/agents/Weaty01/1.webp?q-sign=expired";
  const first = await ensureCachedAvatar(root, "guest", "Weaty01", remote, {
    fetch: async () =>
      new Response(new Uint8Array(tinyWebp()), {
        status: 200,
        headers: { "content-type": "image/webp" },
      }),
  });
  const second = await ensureCachedAvatar(root, "guest", "Weaty01", remote, {
    fetch: async () => new Response("forbidden", { status: 403 }),
    refresh: true,
  });
  expect(second).toBe(first);
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

  const first = await ensureCachedAvatar(root, "guest", "Weaty01", urls[0], { fetch: fetchImpl });
  const second = await ensureCachedAvatar(root, "guest", "Weaty01", urls[1], { fetch: fetchImpl });
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

it("caches user avatar under account/assets and serves offline", async () => {
  const root = tempRoot();
  const bytes = tinyWebp();
  const remote = "https://files.example/prod/avatars/users/uAlice/1.webp?q-sign-time=1;2&q-signature=x";
  let fetches = 0;
  const fetchImpl: typeof fetch = async () => {
    fetches += 1;
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "content-type": "image/webp" },
    });
  };

  const first = await ensureCachedUserAvatar(root, "uAlice", remote, { fetch: fetchImpl, refresh: true });
  expect(first?.startsWith("data:image/webp;base64,")).toBe(true);
  expect(fs.existsSync(path.join(root, "users/uAlice/account/assets/avatar.webp"))).toBe(true);

  const rotated =
    "https://files.example/prod/avatars/users/uAlice/1.webp?q-sign-time=9;10&q-signature=y";
  const second = await ensureCachedUserAvatar(root, "uAlice", rotated, { fetch: fetchImpl });
  expect(fetches).toBe(1);
  expect(second).toBe(first);
  expect(readCachedUserAvatarDataUrl(root, "uAlice")).toBe(first);
});

it("writeCachedUserAvatarDataUrl seeds cache without remote fetch", () => {
  const root = tempRoot();
  const dataUrl = `data:image/webp;base64,${tinyWebp().toString("base64")}`;
  expect(
    writeCachedUserAvatarDataUrl(
      root,
      "uAlice",
      dataUrl,
      "https://files.example/prod/avatars/users/uAlice/2.webp?q-sign=1",
    ),
  ).toBe(dataUrl);
  expect(readCachedUserAvatarDataUrl(root, "uAlice")).toBe(dataUrl);
});

it("skips loc-* agents", async () => {
  const root = tempRoot();
  const result = await ensureCachedAvatar(
    root,
    "guest",
    "loc-abcd1234ef",
    "https://example.test/a.webp",
    {
      fetch: async () =>
        new Response(new Uint8Array(tinyWebp()), {
          status: 200,
          headers: { "content-type": "image/webp" },
        }),
    },
  );
  expect(result).toBeUndefined();
  expect(readCachedAvatarDataUrl(root, "guest", "loc-abcd1234ef")).toBeUndefined();
});
