import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { PERSONAL_ASSISTANT_ID } from "../src/local/assistant/personal-assistant.js";
import { DelegationService, DelegationStore } from "../src/session/delegation/index.js";
import { ApprovalBroker } from "../src/session/hitl/approval/index.js";
import {
  buildArtifactConfirmPrompt,
  copyStagedArtifactsToParent,
  normalizeArtifactPaths,
  shouldForceArtifactConfirm,
  stageArtifactPaths,
  type StagedArtifact,
} from "../src/session/tools/deliver-artifacts.js";
import {
  diffArtifactSnapshots,
  snapshotArtifactDir,
} from "../src/session/workspace/artifact-diff.js";

function tempCwd(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, "ARTIFACT"), { recursive: true });
  return root;
}

it("normalizeArtifactPaths accepts ARTIFACT-relative paths", () => {
  expect(normalizeArtifactPaths(["maze.html", "ARTIFACT/sub/a.txt"])).toEqual([
    "ARTIFACT/maze.html",
    "ARTIFACT/sub/a.txt",
  ]);
});

it("normalizeArtifactPaths rejects escape and non-ARTIFACT paths", () => {
  expect(() => normalizeArtifactPaths(["../etc/passwd"])).toThrow(/ARTIFACT/);
  expect(() => normalizeArtifactPaths(["WORK/x.txt"])).toThrow(/ARTIFACT/);
  expect(() => normalizeArtifactPaths(["ARTIFACT/../WORK/x.txt"])).toThrow(/ARTIFACT/);
  expect(() => normalizeArtifactPaths(["ARTIFACT//a.txt"])).toThrow(/ARTIFACT/);
});

it("stageArtifactPaths fails entirely when any path is missing", () => {
  const cwd = tempCwd("agentup-deliver-miss-");
  fs.writeFileSync(path.join(cwd, "ARTIFACT", "ok.txt"), "hi");
  expect(() => stageArtifactPaths(cwd, ["ARTIFACT/ok.txt", "ARTIFACT/missing.txt"])).toThrow(
    /missing/,
  );
});

it("stageArtifactPaths returns sizes for existing files", () => {
  const cwd = tempCwd("agentup-deliver-ok-");
  fs.writeFileSync(path.join(cwd, "ARTIFACT", "ok.txt"), "hello");
  fs.mkdirSync(path.join(cwd, "ARTIFACT", "sub"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "ARTIFACT", "sub", "b.md"), "world");
  const staged = stageArtifactPaths(cwd, ["ok.txt", "ARTIFACT/sub/b.md"]);
  expect(staged).toEqual([
    { path: "ARTIFACT/ok.txt", size: 5 },
    { path: "ARTIFACT/sub/b.md", size: 5 },
  ]);
});

it("stageArtifactPaths allows empty confirmation", () => {
  const cwd = tempCwd("agentup-deliver-empty-");
  expect(stageArtifactPaths(cwd, [])).toEqual([]);
});

it("copyStagedArtifactsToParent only copies staged files under from-<agentId>", () => {
  const specialist = tempCwd("agentup-deliver-src-");
  const parent = tempCwd("agentup-deliver-dst-");
  fs.writeFileSync(path.join(specialist, "ARTIFACT", "maze.html"), "game");
  fs.writeFileSync(path.join(specialist, "ARTIFACT", "noise.txt"), "other-task");
  const staged: StagedArtifact[] = [{ path: "ARTIFACT/maze.html", size: 4 }];

  const delivered = copyStagedArtifactsToParent({
    sourceCwd: specialist,
    parentCwd: parent,
    toAgentId: "6HhyiCvG",
    staged,
  });

  expect(delivered).toEqual(["ARTIFACT/from-6HhyiCvG/maze.html"]);
  expect(fs.readFileSync(path.join(parent, "ARTIFACT", "from-6HhyiCvG", "maze.html"), "utf8")).toBe(
    "game",
  );
  expect(fs.existsSync(path.join(parent, "ARTIFACT", "from-6HhyiCvG", "noise.txt"))).toBe(false);
  expect(fs.existsSync(path.join(parent, "ARTIFACT", "noise.txt"))).toBe(false);
});

it("copyStagedArtifactsToParent with empty staged writes nothing", () => {
  const specialist = tempCwd("agentup-deliver-none-src-");
  const parent = tempCwd("agentup-deliver-none-dst-");
  fs.writeFileSync(path.join(specialist, "ARTIFACT", "maze.html"), "game");
  expect(
    copyStagedArtifactsToParent({
      sourceCwd: specialist,
      parentCwd: parent,
      toAgentId: "Cody",
      staged: [],
    }),
  ).toEqual([]);
  expect(fs.readdirSync(path.join(parent, "ARTIFACT"))).toEqual([]);
});

it("shouldForceArtifactConfirm only when candidates exist and not yet confirmed", () => {
  expect(shouldForceArtifactConfirm({ candidateCount: 0, confirmed: false, forcedOnce: false })).toBe(
    false,
  );
  expect(shouldForceArtifactConfirm({ candidateCount: 2, confirmed: true, forcedOnce: false })).toBe(
    false,
  );
  expect(shouldForceArtifactConfirm({ candidateCount: 2, confirmed: false, forcedOnce: true })).toBe(
    false,
  );
  expect(shouldForceArtifactConfirm({ candidateCount: 2, confirmed: false, forcedOnce: false })).toBe(
    true,
  );
});

it("buildArtifactConfirmPrompt lists candidates and requires deliver_artifacts", () => {
  const text = buildArtifactConfirmPrompt(["ARTIFACT/a.txt", "ARTIFACT/b.md"]);
  expect(text).toContain("ARTIFACT/a.txt");
  expect(text).toContain("ARTIFACT/b.md");
  expect(text).toContain("deliver_artifacts");
  expect(text).toMatch(/paths:\s*\[\]/);
});

it("task-start diff can include noise; staging selects subset", () => {
  const cwd = tempCwd("agentup-deliver-diff-");
  const before = snapshotArtifactDir(cwd);
  fs.writeFileSync(path.join(cwd, "ARTIFACT", "mine.html"), "a");
  fs.writeFileSync(path.join(cwd, "ARTIFACT", "other.txt"), "b");
  const after = snapshotArtifactDir(cwd);
  const candidates = diffArtifactSnapshots(before, after)
    .files.filter((file) => file.kind === "added" || file.kind === "modified")
    .map((file) => file.path);
  expect(candidates.sort()).toEqual(["ARTIFACT/mine.html", "ARTIFACT/other.txt"]);
  const staged = stageArtifactPaths(cwd, ["ARTIFACT/mine.html"]);
  const parent = tempCwd("agentup-deliver-diff-parent-");
  copyStagedArtifactsToParent({
    sourceCwd: cwd,
    parentCwd: parent,
    toAgentId: "agent1",
    staged,
  });
  expect(fs.existsSync(path.join(parent, "ARTIFACT", "from-agent1", "mine.html"))).toBe(true);
  expect(fs.existsSync(path.join(parent, "ARTIFACT", "from-agent1", "other.txt"))).toBe(false);
});

it("DelegationStore persists artifacts and materializePendingArtifacts copies once", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deliver-svc-"));
  const userId = "patient";
  const specialistId = "spec1";
  const parentCwd = path.join(root, "users", userId, "personal-assistant", "cwd");
  const specialistCwd = path.join(root, "users", userId, "agents", specialistId, "cwd");
  fs.mkdirSync(path.join(parentCwd, "ARTIFACT"), { recursive: true });
  fs.mkdirSync(path.join(specialistCwd, "ARTIFACT"), { recursive: true });
  fs.writeFileSync(path.join(specialistCwd, "ARTIFACT", "maze.html"), "game");
  // openDiskVisit needs instance.json + cwd/.pi
  fs.mkdirSync(path.join(specialistCwd, ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "users", userId, "agents", specialistId, "instance.json"),
    JSON.stringify({
      user_id: userId,
      agent_id: specialistId,
      kind: "recruited",
      package_version: 1,
      package_digest: "d",
      project_trust: "granted",
      tools: [],
      model_capabilities: [],
    }),
  );

  const store = new DelegationStore(root);
  const task = store.create({
    userId,
    fromAgentId: PERSONAL_ASSISTANT_ID,
    toAgentId: specialistId,
    toAgentName: "Spec",
    brief: "make maze",
    wait: false,
  });
  store.update(task.id, {
    status: "completed",
    resultSummary: "done",
    artifacts: [{ path: "ARTIFACT/maze.html", size: 4 }],
  });

  const service = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => stubModel(),
    approvals: new ApprovalBroker(),
    askUser: { request: vi.fn(), answer: vi.fn(), subscribe: vi.fn() } as never,
  });

  service.materializePendingArtifacts(userId, PERSONAL_ASSISTANT_ID, parentCwd);
  const dest = path.join(parentCwd, "ARTIFACT", `from-${specialistId}`, "maze.html");
  expect(fs.readFileSync(dest, "utf8")).toBe("game");
  expect(service.getTask(task.id)?.artifactsDelivered).toBe(true);

  fs.unlinkSync(dest);
  service.materializePendingArtifacts(userId, PERSONAL_ASSISTANT_ID, parentCwd);
  expect(fs.existsSync(dest)).toBe(false);
});

it("materializePendingArtifacts skips unconfirmed tasks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deliver-skip-"));
  const userId = "patient";
  const parentCwd = path.join(root, "users", userId, "personal-assistant", "cwd");
  fs.mkdirSync(path.join(parentCwd, "ARTIFACT"), { recursive: true });
  const store = new DelegationStore(root);
  const task = store.create({
    userId,
    fromAgentId: PERSONAL_ASSISTANT_ID,
    toAgentId: "spec2",
    toAgentName: "Spec",
    brief: "x",
    wait: false,
  });
  store.update(task.id, { status: "completed", resultSummary: "done" });
  const service = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => stubModel(),
    approvals: new ApprovalBroker(),
    askUser: { request: vi.fn(), answer: vi.fn(), subscribe: vi.fn() } as never,
  });
  service.materializePendingArtifacts(userId, PERSONAL_ASSISTANT_ID, parentCwd);
  expect(service.getTask(task.id)?.artifactsDelivered).not.toBe(true);
  expect(fs.readdirSync(path.join(parentCwd, "ARTIFACT"))).toEqual([]);
});

function stubModel() {
  return {
    providerId: "ollama",
    templateId: "ollama",
    modelId: "m",
    apiKey: "k",
    baseUrl: "http://127.0.0.1:11434/v1",
    kind: "ollama" as const,
  };
}
