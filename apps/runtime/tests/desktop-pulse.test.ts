import { Hono } from "hono";
import { expect, it } from "vitest";

import type { LocalAppDeps, LocalAppEnv } from "../src/local/http.js";
import { registerDesktopPulseRoutes } from "../src/local/routes/desktop-pulse.js";

it("GET /desktop-pulse merges attention fleets and local groups", async () => {
  const deps = {
    chats: {
      busyTurns: (userId: string) =>
        userId === "u1"
          ? [
              {
                agentId: "personal-assistant",
                phase: "wake" as const,
                sources: [{ name: "前端", kind: "delegation" as const }],
              },
            ]
          : [],
    },
    approvals: { restoreUser() {}, listPending: () => [] },
    askUser: { restoreUser() {}, listPending: () => [] },
    shellHang: { listPending: () => [] },
    delegation: {
      findNestingParent: () => undefined,
      listTasks: (
        userId: string,
        options: { status?: string; unseenOnly?: boolean },
      ) => {
        if (userId !== "u1") return [];
        if (options.status === "running") {
          return [
            {
              id: "d-run",
              userId: "u1",
              fromAgentId: "personal-assistant",
              toAgentId: "fe",
              toAgentName: "前端",
              brief: "做 UI",
              status: "running",
              wait: false,
              seen: false,
              notified: false,
              createdAt: 1,
              updatedAt: 2,
            },
          ];
        }
        if (options.unseenOnly) {
          return [
            {
              id: "d-done",
              userId: "u1",
              fromAgentId: "personal-assistant",
              toAgentId: "fe",
              toAgentName: "前端",
              brief: "做 UI",
              status: "completed",
              wait: false,
              resultSummary: "ok",
              seen: false,
              notified: true,
              createdAt: 1,
              updatedAt: 3,
            },
          ];
        }
        return [];
      },
      notifyParent() {},
    },
    backgroundJobs: {
      list: (userId: string, options: { status?: string; unseenOnly?: boolean }) => {
        if (userId !== "u1") return [];
        if (options.status === "running") {
          return [
            {
              id: "j-run",
              userId: "u1",
              agentId: "personal-assistant",
              name: "build",
              command: "pnpm build",
              status: "running",
              seen: false,
              notified: false,
              createdAt: 4,
              updatedAt: 5,
            },
          ];
        }
        if (options.unseenOnly) return [];
        return [];
      },
      notifyOwner() {},
    },
    groupTurns: {
      list: (userId: string) =>
        userId === "u1"
          ? [
              {
                id: "g1",
                userId: "u1",
                title: "开发群",
                members: [],
                lines: [],
                holderId: null,
                holderSpeaking: false,
                phase: "idle" as const,
                taskIds: [],
                pendingDelegations: [],
                queue: [],
                version: 3 as const,
              },
            ]
          : [],
      linePage: () => ({ lines: [], hasMore: false }),
    },
  } as unknown as LocalAppDeps;

  const app = new Hono<LocalAppEnv>();
  registerDesktopPulseRoutes(app, deps);
  const res = await app.request("/desktop-pulse?user_id=u1", {
    headers: { authorization: "Bearer token" },
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    attention: {
      busy_agent_ids: ["personal-assistant"],
      busy_turns: [{ agent_id: "personal-assistant", phase: "wake" }],
    },
    delegations: {
      running: [{ id: "d-run", status: "running", from_agent_id: "personal-assistant" }],
      unseen: [{ id: "d-done", status: "completed", notified: true }],
    },
    background_jobs: {
      running: [{ id: "j-run", status: "running", agent_id: "personal-assistant" }],
      unseen: [],
    },
    groups: [{ id: "g1", title: "开发群", phase: "idle", linesHasMore: false }],
  });
});
