import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { BackgroundJobs } from "../src/session/background/index.js";
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
