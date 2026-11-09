import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { PERSONAL_ASSISTANT_ID } from "../src/local/assistant/personal-assistant.js";
import {
  listUnpresentedDeliverables,
  markDeliverablesPresented,
  deliverTaskArtifacts,
} from "../src/session/delegation/service/artifacts.js";
import { resolveWakeDeliveredPaths } from "../src/session/delegation/service/notify.js";
import { DelegationStore } from "../src/session/delegation/store.js";
import {
  applyPresentArtifactsAction,
  parseDeliverablesEntryData,
} from "../src/session/history/deliverables.js";
import { resolveExecutionTools } from "../src/session/context/tool-policy.js";

it("present_artifacts is on parent modes only, not specialist sessions", () => {
  const shell = { shellTools: ["bash"], mcp: false };
  expect(resolveExecutionTools("single", shell)).toContain("present_artifacts");
  expect(resolveExecutionTools("group-holder", shell)).toContain("present_artifacts");
  expect(resolveExecutionTools("single-delegation", shell)).not.toContain("present_artifacts");
  expect(resolveExecutionTools("group-delegation", shell)).not.toContain("present_artifacts");
});

it("applyPresentArtifactsAction set/add/remove curates the grid set", () => {
  const base = applyPresentArtifactsAction({
    action: "set",
    paths: ["ARTIFACT/a.md", "b.txt"],
    current: new Map(),
  });
  expect([...base.keys()]).toEqual(["ARTIFACT/a.md", "ARTIFACT/b.txt"]);

  const added = applyPresentArtifactsAction({
    action: "add",
    paths: ["ARTIFACT/c.md"],
    current: base,
  });
  expect([...added.keys()]).toEqual(["ARTIFACT/a.md", "ARTIFACT/b.txt", "ARTIFACT/c.md"]);

  const removed = applyPresentArtifactsAction({
    action: "remove",
    paths: ["ARTIFACT/b.txt"],
    current: added,
  });
  expect([...removed.keys()]).toEqual(["ARTIFACT/a.md", "ARTIFACT/c.md"]);

  const cleared = applyPresentArtifactsAction({
    action: "set",
    paths: [],
    current: removed,
  });
  expect(cleared.size).toBe(0);
});

it("applyPresentArtifactsAction set keeps seeded size when cwd has no file", () => {
  const current = new Map([
    ["ARTIFACT/a.md", { path: "ARTIFACT/a.md", size: 42 }],
  ]);
  const next = applyPresentArtifactsAction({
    action: "set",
    paths: ["ARTIFACT/a.md"],
    current,
    cwd: "/tmp/agentup-missing-deliverable-cwd",
  });
  expect(next.get("ARTIFACT/a.md")).toEqual({ path: "ARTIFACT/a.md", size: 42 });
});

it("parseDeliverablesEntryData keeps curated empty sets and drops empty non-curated", () => {
  expect(parseDeliverablesEntryData({ files: [] })).toBeUndefined();
  expect(parseDeliverablesEntryData({ files: [], curated: true })).toEqual({
    files: [],
    curated: true,
  });
  expect(
    parseDeliverablesEntryData({
      files: [{ path: "ARTIFACT/out.md", size: 3 }, { path: "WORK/x.txt" }],
    }),
  ).toEqual({ files: [{ path: "ARTIFACT/out.md", size: 3 }] });
});

it("deliverTaskArtifacts writes parent deliveredPaths for 1:1 copy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-delivered-paths-"));
  const userId = "patient";
  const specialistId = "spec1";
  const parentCwd = path.join(root, "users", userId, "personal-assistant", "cwd");
  const sourceCwd = path.join(root, "users", userId, "agents", specialistId, "cwd");
  fs.mkdirSync(path.join(parentCwd, "ARTIFACT"), { recursive: true });
  fs.mkdirSync(path.join(sourceCwd, "ARTIFACT"), { recursive: true });
  fs.writeFileSync(path.join(sourceCwd, "ARTIFACT", "maze.html"), "game");

  const store = new DelegationStore(root);
  const task = store.create({
    userId,
    fromAgentId: PERSONAL_ASSISTANT_ID,
    toAgentId: specialistId,
    toAgentName: "Spec",
    brief: "make maze",
    wait: true,
  });
  store.update(task.id, {
    status: "completed",
    resultSummary: "done",
    artifacts: [{ path: "ARTIFACT/maze.html", size: 4 }],
  });

  deliverTaskArtifacts(store, root, store.get(task.id)!, sourceCwd, parentCwd);
  const next = store.get(task.id)!;
  expect(next.artifactsDelivered).toBe(true);
  expect(next.deliveredPaths).toEqual([
    { path: "ARTIFACT/from-Spec-spec1/maze.html", size: 4 },
  ]);
});

it("deliverTaskArtifacts for group only keeps ARTIFACT paths in deliveredPaths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-delivered-"));
  const store = new DelegationStore(root);
  const task = store.create({
    userId: "patient",
    fromAgentId: PERSONAL_ASSISTANT_ID,
    toAgentId: "spec1",
    toAgentName: "Spec",
    brief: "shared",
    wait: false,
  });
  store.update(task.id, {
    status: "completed",
    groupId: "g1",
    artifacts: [
      { path: "ARTIFACT/from-Spec-t1/out.md", size: 2 },
      { path: "WORK/from-Spec-t1/draft.txt", size: 1 },
    ],
  });
  deliverTaskArtifacts(store, root, store.get(task.id)!, "/tmp/unused");
  const next = store.get(task.id)!;
  expect(next.artifactsDelivered).toBe(true);
  expect(next.deliveredPaths).toEqual([{ path: "ARTIFACT/from-Spec-t1/out.md", size: 2 }]);
});

it("listUnpresentedDeliverables skips presented tasks; mark sticky", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-present-list-"));
  const store = new DelegationStore(root);
  const task = store.create({
    userId: "patient",
    fromAgentId: PERSONAL_ASSISTANT_ID,
    toAgentId: "spec1",
    toAgentName: "Spec",
    brief: "x",
    wait: false,
  });
  store.update(task.id, {
    status: "completed",
    artifactsDelivered: true,
    deliveredPaths: [{ path: "ARTIFACT/from-Spec-spec1/a.md", size: 1 }],
  });
  expect(listUnpresentedDeliverables(store, "patient", PERSONAL_ASSISTANT_ID)).toEqual([
    { taskId: task.id, files: [{ path: "ARTIFACT/from-Spec-spec1/a.md", size: 1 }] },
  ]);
  markDeliverablesPresented(store, [task.id]);
  expect(listUnpresentedDeliverables(store, "patient", PERSONAL_ASSISTANT_ID)).toEqual([]);
});

it("resolveWakeDeliveredPaths predicts parent paths before materialize", () => {
  const paths = resolveWakeDeliveredPaths({
    id: "t1",
    userId: "u",
    fromAgentId: PERSONAL_ASSISTANT_ID,
    toAgentId: "spec1",
    toAgentName: "Spec",
    brief: "x",
    status: "completed",
    createdAt: 1,
    updatedAt: 1,
    wait: false,
    seen: false,
    notified: false,
    artifacts: [{ path: "ARTIFACT/note.md", size: 9 }],
  });
  expect(paths).toEqual([{ path: "ARTIFACT/from-Spec-spec1/note.md", size: 9 }]);
});
