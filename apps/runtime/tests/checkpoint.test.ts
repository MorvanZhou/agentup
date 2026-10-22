import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  checkpointRoot,
  clearCheckpoints,
  listCheckpointTurnOrder,
  listTurnSnapshots,
  maxCheckpointTurns,
  restoreAbandonedTurns,
  snapshotBeforeMutation,
} from "../src/session/checkpoint/checkpoint.js";
import { createCheckpointExtension } from "../src/session/checkpoint/extension.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

it("snapshots a file once per turn and restores the earliest abandoned turn", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-ckpt-"));
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(cwd, "note.txt");
  fs.writeFileSync(file, "v1", "utf8");
  const dir = checkpointRoot(root);

  expect(snapshotBeforeMutation(cwd, dir, "turn-a", "note.txt")).toEqual({ snapped: true });
  expect(snapshotBeforeMutation(cwd, dir, "turn-a", "note.txt").snapped).toBe(false);
  fs.writeFileSync(file, "v2", "utf8");

  expect(snapshotBeforeMutation(cwd, dir, "turn-b", "note.txt")).toEqual({ snapped: true });
  fs.writeFileSync(file, "v3", "utf8");

  expect(listTurnSnapshots(dir, "turn-a")).toEqual([{ relativePath: "note.txt", content: "v1" }]);
  expect(listTurnSnapshots(dir, "turn-b")).toEqual([{ relativePath: "note.txt", content: "v2" }]);

  const result = restoreAbandonedTurns(cwd, dir, ["turn-a", "turn-b"]);
  expect(result.restored).toEqual(["note.txt"]);
  expect(fs.readFileSync(file, "utf8")).toBe("v1");
});

it("treats a new write as missing and deletes on restore", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-ckpt-miss-"));
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(cwd, { recursive: true });
  const dir = checkpointRoot(root);
  const file = path.join(cwd, "fresh.txt");

  expect(snapshotBeforeMutation(cwd, dir, "t1", "fresh.txt")).toEqual({ snapped: true });
  fs.writeFileSync(file, "created", "utf8");
  const result = restoreAbandonedTurns(cwd, dir, ["t1"]);
  expect(result.deleted).toEqual(["fresh.txt"]);
  expect(fs.existsSync(file)).toBe(false);
});

it("rejects path traversal and clears checkpoint tree", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-ckpt-safe-"));
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(cwd, { recursive: true });
  const dir = checkpointRoot(root);
  expect(snapshotBeforeMutation(cwd, dir, "t1", "../secret").snapped).toBe(false);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "x"), "y");
  clearCheckpoints(root);
  expect(fs.existsSync(dir)).toBe(false);
});

it("reads max turns from env with a safe default", () => {
  expect(maxCheckpointTurns({})).toBe(100);
  expect(maxCheckpointTurns({ AGENTUP_CHECKPOINT_MAX_TURNS: "3" })).toBe(3);
  expect(maxCheckpointTurns({ AGENTUP_CHECKPOINT_MAX_TURNS: "0" })).toBe(100);
  expect(maxCheckpointTurns({ AGENTUP_CHECKPOINT_MAX_TURNS: "nope" })).toBe(100);
});

it("prunes the oldest turn dirs when over the max", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-ckpt-prune-"));
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(cwd, { recursive: true });
  const dir = checkpointRoot(root);
  for (const turn of ["t1", "t2", "t3"]) {
    fs.writeFileSync(path.join(cwd, `${turn}.txt`), turn, "utf8");
    expect(snapshotBeforeMutation(cwd, dir, turn, `${turn}.txt`, { maxTurns: 2 }).snapped).toBe(true);
  }
  expect(listCheckpointTurnOrder(dir)).toEqual(["t2", "t3"]);
  expect(fs.existsSync(path.join(dir, "t1"))).toBe(false);
  expect(listTurnSnapshots(dir, "t2")).toHaveLength(1);
});

it("extension snapshots on write and restores on session_before_tree", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-ckpt-ext-"));
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(cwd, "a.ts");
  fs.writeFileSync(file, "old", "utf8");

  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>();
  createCheckpointExtension(root)({
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI);

  const userEntry = { type: "message" as const, id: "user-1", message: { role: "user" as const, content: "改文件" } };
  const assistantEntry = {
    type: "message" as const,
    id: "asst-1",
    message: { role: "assistant" as const, content: "已写" },
  };
  const entries = new Map<string, typeof userEntry | typeof assistantEntry>([
    [userEntry.id, userEntry],
    [assistantEntry.id, assistantEntry],
  ]);
  const ctx = {
    cwd,
    sessionManager: {
      getBranch: () => [userEntry],
      getEntry: (id: string) => entries.get(id),
      getCwd: () => cwd,
    },
  } as unknown as ExtensionContext;

  await handlers.get("tool_call")?.(
    { type: "tool_call", toolName: "write", toolCallId: "c1", input: { path: "a.ts", content: "new" } },
    ctx,
  );
  fs.writeFileSync(file, "new", "utf8");

  // 与 Pi 一致：导航到 user-1 时 entriesToSummarize 不含目标本身（仅其后节点）。
  await handlers.get("session_before_tree")?.(
    {
      type: "session_before_tree",
      preparation: {
        targetId: "user-1",
        oldLeafId: "asst-1",
        commonAncestorId: "user-1",
        entriesToSummarize: [assistantEntry],
        userWantsSummary: false,
      },
      signal: new AbortController().signal,
    },
    ctx,
  );
  expect(fs.readFileSync(file, "utf8")).toBe("old");
});

it("extension deletes a newly written file when rewinding the creating turn", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-ckpt-ext-new-"));
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(cwd, "fresh.txt");

  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>();
  createCheckpointExtension(root)({
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI);

  const userEntry = {
    type: "message" as const,
    id: "user-new",
    message: { role: "user" as const, content: "新建文件" },
  };
  const ctx = {
    cwd,
    sessionManager: {
      getBranch: () => [userEntry],
      getEntry: (id: string) => (id === userEntry.id ? userEntry : undefined),
      getCwd: () => cwd,
    },
  } as unknown as ExtensionContext;

  await handlers.get("tool_call")?.(
    {
      type: "tool_call",
      toolName: "write",
      toolCallId: "c1",
      input: { path: "fresh.txt", content: "created" },
    },
    ctx,
  );
  fs.writeFileSync(file, "created", "utf8");

  await handlers.get("session_before_tree")?.(
    {
      type: "session_before_tree",
      preparation: {
        targetId: "user-new",
        oldLeafId: "asst",
        commonAncestorId: "user-new",
        entriesToSummarize: [],
        userWantsSummary: false,
      },
      signal: new AbortController().signal,
    },
    ctx,
  );
  expect(fs.existsSync(file)).toBe(false);
});

it("snapshots edit on a follow-up user turn even if the previous turn already snapped the path", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-ckpt-followup-"));
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(cwd, { recursive: true });
  const file = path.join(cwd, "add.py");
  const dir = checkpointRoot(root);

  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>();
  createCheckpointExtension(root)({
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI);

  const user1 = { type: "message" as const, id: "user-1", message: { role: "user" as const, content: "写文件" } };
  const user2 = { type: "message" as const, id: "user-2", message: { role: "user" as const, content: "简化" } };
  const byId = new Map<string, typeof user1 | typeof user2>([
    [user1.id, user1],
    [user2.id, user2],
  ]);
  let branch: Array<typeof user1 | typeof user2> = [user1];
  const ctx = {
    cwd,
    sessionManager: {
      getBranch: () => branch,
      getEntry: (id: string) => byId.get(id),
      getCwd: () => cwd,
    },
  } as unknown as ExtensionContext;

  // 第一轮 Write：文件尚不存在
  await handlers.get("tool_call")?.(
    { type: "tool_call", toolName: "write", toolCallId: "c1", input: { path: "add.py", content: "v1\n" } },
    ctx,
  );
  fs.writeFileSync(file, "v1\n", "utf8");
  expect(listTurnSnapshots(dir, "user-1")).toEqual([{ relativePath: "add.py", content: null }]);

  // 第二轮 Edit：必须记在 user-2，不能因上一 turn 已 snap 而跳过
  branch = [user1, user2];
  await handlers.get("tool_call")?.(
    {
      type: "tool_call",
      toolName: "edit",
      toolCallId: "c2",
      input: { path: "add.py", oldText: "v1\n", newText: "v2\n" },
    },
    ctx,
  );
  fs.writeFileSync(file, "v2\n", "utf8");
  expect(listTurnSnapshots(dir, "user-2")).toEqual([{ relativePath: "add.py", content: "v1\n" }]);

  await handlers.get("session_before_tree")?.(
    {
      type: "session_before_tree",
      preparation: {
        targetId: "user-2",
        oldLeafId: "leaf",
        commonAncestorId: "user-2",
        entriesToSummarize: [],
        userWantsSummary: false,
      },
      signal: new AbortController().signal,
    },
    ctx,
  );
  expect(fs.readFileSync(file, "utf8")).toBe("v1\n");
});
