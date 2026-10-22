import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { listDiskSyncedAgents } from "../src/local/agents/disk-synced.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-disk-synced-"));
  roots.push(root);
  return root;
}

it("lists projected market agents and skips loc-*", () => {
  const root = tempRoot();
  const user = "guest";
  const marketRoot = path.join(root, "users", user, "agents", "ExAgent");
  const localRoot = path.join(root, "users", user, "agents", "loc-private");
  fs.mkdirSync(path.join(marketRoot, "cwd", ".pi"), { recursive: true });
  fs.mkdirSync(localRoot, { recursive: true });
  fs.writeFileSync(
    path.join(marketRoot, "instance.json"),
    JSON.stringify({
      agent_id: "ExAgent",
      package_version: 2,
      package_digest: "abc",
    }),
  );
  fs.writeFileSync(
    path.join(marketRoot, "cwd", ".pi", "SYSTEM.md"),
    "你是Ex。岗位：汇率员。\n\n协助用户获取汇率信息\n",
  );
  fs.writeFileSync(
    path.join(localRoot, "instance.json"),
    JSON.stringify({ kind: "local", agent_id: "loc-private", name: "Draw" }),
  );

  const listed = listDiskSyncedAgents(root, user);
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({
    agentId: "ExAgent",
    name: "Ex",
    role: "汇率员",
    packageVersion: 2,
    packageDigest: "abc",
  });
  expect(listed[0]?.background).toContain("汇率");
});

it("returns empty for invalid user id or missing tree", () => {
  const root = tempRoot();
  expect(listDiskSyncedAgents(root, "")).toEqual([]);
  expect(listDiskSyncedAgents(root, "../x")).toEqual([]);
  expect(listDiskSyncedAgents(root, "nobody")).toEqual([]);
});
