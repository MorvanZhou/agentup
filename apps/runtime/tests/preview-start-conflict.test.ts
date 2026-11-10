import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import type { BackgroundJob } from "../src/session/background/types.js";
import { PreviewService } from "../src/session/preview/service.js";
import { upsertPreviewRecipe } from "../src/session/workspace/workspace-config.js";

function fakeJobs(overrides: {
  startImpl?: () => Promise<BackgroundJob>;
  getImpl?: (id: string) => BackgroundJob | undefined;
}) {
  const cancelled: string[] = [];
  return {
    cancelled,
    jobs: {
      start: async () => {
        if (overrides.startImpl) return overrides.startImpl();
        return {
          id: "job-new",
          userId: "u1",
          agentId: "a1",
          name: "preview",
          command: "true",
          cwd: "/",
          status: "running",
          createdAt: 0,
          updatedAt: 0,
          seen: false,
          notified: false,
          silent: true,
          pid: 99999,
        } satisfies BackgroundJob;
      },
      get: (id: string) => overrides.getImpl?.(id),
      cancel: (id: string) => {
        cancelled.push(id);
        return {
          id,
          userId: "u1",
          agentId: "a1",
          name: "x",
          command: "x",
          cwd: "/",
          status: "cancelled",
          createdAt: 0,
          updatedAt: 0,
          seen: false,
          notified: true,
        } satisfies BackgroundJob;
      },
      list: () => [] as BackgroundJob[],
      findActiveByPid: () => undefined,
    },
  };
}

it("start returns conflict when port occupied by a different pid", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-preview-conflict-"));
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  upsertPreviewRecipe(root, {
    id: "web",
    title: "Dev",
    command: "npm run dev",
    cwd: ".",
    preview_url: `http://127.0.0.1:${port}`,
    linked_pid: process.pid + 1_000_000,
  });
  const { jobs } = fakeJobs({});
  const preview = new PreviewService(jobs as never);
  try {
    const result = await preview.start({
      userId: "u1",
      agentId: "a1",
      workspaceRoot: root,
      recipeId: "web",
      scope: { kind: "agent", agentId: "a1" },
    });
    expect(result.status).toBe("conflict");
    if (result.status === "conflict") {
      expect(result.pid).toBe(process.pid);
      expect(result.preview_url).toContain(String(port));
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("force start proceeds when no occupant remains", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-preview-force-"));
  upsertPreviewRecipe(root, {
    id: "web",
    title: "Dev",
    command: "true",
    cwd: ".",
    preview_url: "http://127.0.0.1:9",
    linked_job_id: "job-old",
    linked_pid: 1,
  });
  let started = 0;
  const { jobs, cancelled } = fakeJobs({
    startImpl: async () => {
      started += 1;
      return {
        id: "job-forced",
        userId: "u1",
        agentId: "a1",
        name: "preview",
        command: "true",
        cwd: root,
        status: "failed",
        createdAt: 0,
        updatedAt: 0,
        seen: false,
        notified: true,
        silent: true,
      };
    },
    getImpl: () => ({
      id: "job-forced",
      userId: "u1",
      agentId: "a1",
      name: "preview",
      command: "true",
      cwd: root,
      status: "failed",
      createdAt: 0,
      updatedAt: 0,
      seen: false,
      notified: true,
      silent: true,
    }),
  });
  const preview = new PreviewService(jobs as never);
  const result = await preview.start({
    userId: "u1",
    agentId: "a1",
    workspaceRoot: root,
    recipeId: "web",
    scope: { kind: "agent", agentId: "a1" },
    force: true,
  });
  expect(result.status).toBe("started");
  expect(started).toBe(1);
  expect(cancelled).toContain("job-old");
});
