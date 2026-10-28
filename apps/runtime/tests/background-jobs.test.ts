import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { BackgroundJobs, BackgroundJobStore } from "../src/session/background/index.js";
import { buildSessionPlan } from "../src/session/plan.js";
import { PERSONAL_ASSISTANT_ID } from "../src/local/assistant/personal-assistant.js";
import {
  BG_KILL_TOOL,
  BG_RUN_TOOL,
  BG_STATUS_TOOL,
} from "../src/session/tools/index.js";

it("exposes bg tools in session plan", () => {
  const plan = buildSessionPlan(
    {
      kind: "personal",
      userId: "u",
      agentId: PERSONAL_ASSISTANT_ID,
      root: "/tmp/pa",
      packageVersion: 0,
      packageDigest: "d",
      tools: [],
      modelCapabilities: [],
      projectTrust: "granted",
    },
    {
      providerId: "ollama",
      templateId: "ollama",
      modelId: "m",
      apiKey: "k",
      baseUrl: "http://127.0.0.1:11434/v1",
      kind: "ollama" as const,
    },
  );
  expect(plan.tools).toContain(BG_RUN_TOOL);
  expect(plan.tools).toContain(BG_STATUS_TOOL);
  expect(plan.tools).toContain(BG_KILL_TOOL);
});

it("runs a short command and completes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-bg-"));
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(cwd, { recursive: true });
  const jobs = new BackgroundJobs({ userDataRoot: root });
  const started = await jobs.start({
    userId: "patient",
    agentId: PERSONAL_ASSISTANT_ID,
    command: "echo hello-bg",
    cwd,
    name: "echo",
  });
  expect(started.status).toBe("running");

  const deadline = Date.now() + 5000;
  let done = jobs.get(started.id);
  while (done && done.status === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    done = jobs.get(started.id);
  }
  expect(done?.status).toBe("completed");
  expect(done?.exitCode).toBe(0);
  expect(done?.outputTail ?? "").toContain("hello-bg");
});

it("cancels a long-running job", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-bg-cancel-"));
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(cwd, { recursive: true });
  const jobs = new BackgroundJobs({ userDataRoot: root });
  const started = await jobs.start({
    userId: "patient",
    agentId: PERSONAL_ASSISTANT_ID,
    command: "sleep 30",
    cwd,
    name: "sleep",
  });
  // 等进 running 槽
  await new Promise((resolve) => setTimeout(resolve, 100));
  const cancelled = jobs.cancel(started.id, "patient");
  expect(cancelled.status).toBe("cancelled");

  const deadline = Date.now() + 3000;
  let latest = jobs.get(started.id);
  while (latest && latest.status === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    latest = jobs.get(started.id);
  }
  expect(latest?.status).toBe("cancelled");
});

it("fails leftover background jobs on restart but leaves a live job running", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-bg-interrupt-"));
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(cwd, { recursive: true });
  const store = new BackgroundJobStore(root);
  const orphan = store.create({
    userId: "patient",
    agentId: PERSONAL_ASSISTANT_ID,
    name: "orphan-sleep",
    command: "sleep 30",
    cwd,
  });
  store.update(orphan.id, { status: "running" });
  const queued = store.create({
    userId: "patient",
    agentId: PERSONAL_ASSISTANT_ID,
    name: "queued-build",
    command: "echo hi",
    cwd,
  });

  const wakes: string[] = [];
  const jobs = new BackgroundJobs({
    userDataRoot: root,
    enqueueWake: (item) => wakes.push(item.body),
  });
  const live = await jobs.start({
    userId: "patient",
    agentId: PERSONAL_ASSISTANT_ID,
    command: "sleep 30",
    cwd,
    name: "live-sleep",
  });
  await new Promise((resolve) => setTimeout(resolve, 80));

  const settled = jobs.recoverInterrupted();
  expect(settled.map((job) => job.id).sort()).toEqual([orphan.id, queued.id].sort());
  expect(jobs.get(orphan.id)).toMatchObject({
    status: "failed",
    error: "应用已退出，这项工作在完成前中断",
  });
  expect(jobs.get(queued.id)?.status).toBe("failed");
  expect(jobs.list("patient", { status: "running" }).map((job) => job.id)).toEqual([live.id]);
  expect(wakes).toHaveLength(2);
  expect(wakes.join("\n")).toContain("orphan-sleep");
  expect(wakes.join("\n")).toContain("queued-build");
  expect(wakes.join("\n")).not.toContain("live-sleep");

  expect(jobs.recoverInterrupted()).toEqual([]);
  expect(wakes).toHaveLength(2);
  jobs.cancel(live.id, "patient");
});

it("returns a group-owned background job to that group instead of the one-to-one wake", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-bg-group-"));
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(cwd, { recursive: true });
  const store = new BackgroundJobStore(root);
  const created = store.create({
    userId: "u1",
    agentId: "pm",
    name: "build",
    command: "echo hi",
    cwd,
    groupId: "g1",
  });
  store.update(created.id, { status: "completed", exitCode: 0, outputTail: "ok" });
  const wakes: string[] = [];
  const groups: string[] = [];
  const jobs = new BackgroundJobs({
    userDataRoot: root,
    enqueueWake: (item) => wakes.push(item.agentId),
    deliverGroup: (job) => groups.push(job.groupId ?? ""),
  });
  expect(jobs.list("u1").map((job) => job.id)).toEqual([created.id]);
  jobs.notifyOwner(jobs.get(created.id)!);
  expect(wakes).toEqual([]);
  expect(groups).toEqual(["g1"]);
  expect(jobs.get(created.id)?.notified).toBe(true);
});
