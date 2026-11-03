import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { BackendClientError } from "../src/control/errors.js";
import { isCloudAuthSkip, type CloudGroup } from "../src/control/groups-api.js";
import { reconcileGroups } from "../src/local/group-cloud.js";
import { resolveGroupMembers } from "../src/local/group-member-names.js";
import { GroupStore } from "../src/session/group/store.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("skips cloud sync only on 401", () => {
  expect(isCloudAuthSkip(new BackendClientError("未登录", 401))).toBe(true);
  expect(isCloudAuthSkip(new BackendClientError("找不到群", 404))).toBe(false);
  expect(isCloudAuthSkip(new Error("network"))).toBe(false);
});

it("reconcile pulls cloud-only groups and backfills local-only", async () => {
  const pulled: string[] = [];
  const upserted: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && url.endsWith("/v1/groups")) {
      return jsonResponse({
        groups: [
          cloudRow("cloud1", "云端群", ["a1", "b2"]),
          cloudRow("both1", "云端旧名", ["a1", "b2"]),
        ],
      });
    }
    if (method === "POST" && url.endsWith("/v1/groups")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { group_id?: string };
      upserted.push(body.group_id ?? "");
      return jsonResponse(cloudRow(body.group_id ?? "x", "local", ["a1", "b2"]));
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;

  const result = await reconcileGroups(
    "http://cloud.test",
    "tok",
    [
      {
        id: "both1",
        title: "本机名",
        members: [
          { agentId: "a1", name: "A" },
          { agentId: "b2", name: "B" },
        ],
      },
      {
        id: "local1",
        title: "仅本机",
        members: [
          { agentId: "a1", name: "A" },
          { agentId: "b2", name: "B" },
        ],
      },
    ],
    async (cloud: CloudGroup) => {
      pulled.push(cloud.groupId);
    },
    fetchImpl,
  );

  expect(result.pulled).toBe(1);
  expect(pulled).toEqual(["cloud1"]);
  expect(upserted).toEqual(["local1"]);
});

it("reconcile skips pull and backfill on guest 401", async () => {
  const pull = vi.fn();
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "未登录" }), { status: 401 })) as typeof fetch;
  const result = await reconcileGroups(
    "http://cloud.test",
    "guest",
    [
      {
        id: "local1",
        title: "仅本机",
        members: [
          { agentId: "a1", name: "A" },
          { agentId: "b2", name: "B" },
        ],
      },
    ],
    pull,
    fetchImpl,
  );
  expect(result.pulled).toBe(0);
  expect(pull).not.toHaveBeenCalled();
});

it("createWithId restores empty shell and does not overwrite local", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-pull-"));
  const store = new GroupStore(root);
  const first = store.createWithId({
    id: "grpshell1",
    userId: "u1",
    title: "云端标题",
    members: [
      { agentId: "a1", name: "Alice" },
      { agentId: "b2", name: "Bob" },
    ],
  });
  expect(first.id).toBe("grpshell1");
  expect(first.title).toBe("云端标题");
  expect(first.lines).toEqual([]);
  expect(first.phase).toBe("idle");

  store.rename("u1", "grpshell1", "本机改名");
  const again = store.createWithId({
    id: "grpshell1",
    userId: "u1",
    title: "云端旧名",
    members: [
      { agentId: "c3", name: "Carl" },
      { agentId: "d4", name: "Dana" },
    ],
  });
  expect(again.title).toBe("本机改名");
  expect(again.members.map((m) => m.agentId)).toEqual(["a1", "b2"]);
});

it("resolveGroupMembers uses disk name or falls back to agent id", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-names-"));
  const agentRoot = path.join(root, "users", "u1", "agents", "agent-a");
  fs.mkdirSync(path.join(agentRoot, "cwd", ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(agentRoot, "instance.json"),
    JSON.stringify({ name: "映月", role: "编辑", package_version: 1, package_digest: "d1" }),
  );
  const members = resolveGroupMembers(root, "u1", ["agent-a", "missing-z"]);
  expect(members).toEqual([
    { agentId: "agent-a", name: "映月" },
    { agentId: "missing-z", name: "missing-z" },
  ]);
});

it("GET /groups pulls cloud shell onto empty device", async () => {
  const { startLocalServer } = await import("../src/local/server.js");
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-http-pull-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // 本机 loopback 仍走真 fetch；只拦控制面
    if (!url.includes("cloud.test")) return originalFetch(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/v1/groups") && method === "GET") {
      return jsonResponse({
        groups: [cloudRow("remote99", "跨设备群", ["alpha1", "beta2"])],
      });
    }
    if (url.includes("/v1/groups") && method === "POST") {
      return jsonResponse(cloudRow("x", "x", ["alpha1", "beta2"]));
    }
    return new Response(JSON.stringify({ error: "nope" }), { status: 404 });
  }) as typeof fetch;
  const local = await startLocalServer({
    host: "127.0.0.1",
    port: 0,
    userDataRoot: dataRoot,
    backendUrl: "http://cloud.test",
  });
  try {
    const listed = await originalFetch(`${local.url}/groups?user_id=u1`, {
      headers: { authorization: "Bearer tok" },
    });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      groups: Array<{ id: string; title: string; members: Array<{ agentId: string; name: string }> }>;
    };
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]?.id).toBe("remote99");
    expect(body.groups[0]?.title).toBe("跨设备群");
    expect(body.groups[0]?.members).toEqual([
      { agentId: "alpha1", name: "alpha1" },
      { agentId: "beta2", name: "beta2" },
    ]);
    // 索引已落盘
    expect(
      fs.existsSync(path.join(dataRoot, "users", "u1", ".runtime", "groups", "remote99.json")),
    ).toBe(true);
  } finally {
    await local.close();
    globalThis.fetch = originalFetch;
  }
});

it("GET /groups keeps local title when cloud has same id", async () => {
  const { startLocalServer } = await import("../src/local/server.js");
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-http-keep-"));
  const store = new GroupStore(dataRoot);
  store.createWithId({
    id: "keepme01",
    userId: "u1",
    title: "本机标题",
    members: [
      { agentId: "a1", name: "A" },
      { agentId: "b2", name: "B" },
    ],
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("cloud.test")) return originalFetch(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/v1/groups") && method === "GET") {
      return jsonResponse({
        groups: [cloudRow("keepme01", "云端旧标题", ["a1", "b2", "c3", "d4"])],
      });
    }
    return jsonResponse({});
  }) as typeof fetch;
  const local = await startLocalServer({
    host: "127.0.0.1",
    port: 0,
    userDataRoot: dataRoot,
    backendUrl: "http://cloud.test",
  });
  try {
    const listed = await originalFetch(`${local.url}/groups?user_id=u1`, {
      headers: { authorization: "Bearer tok" },
    });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      groups: Array<{ id: string; title: string; members: Array<{ agentId: string }> }>;
    };
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]?.title).toBe("本机标题");
    expect(body.groups[0]?.members.map((m) => m.agentId)).toEqual(["a1", "b2"]);
  } finally {
    await local.close();
    globalThis.fetch = originalFetch;
  }
});

function cloudRow(groupId: string, title: string, members: string[]) {
  return {
    group_id: groupId,
    title,
    members,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
