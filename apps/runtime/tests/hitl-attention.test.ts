import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Hono } from "hono";
import { expect, it } from "vitest";

import { startLocalServer } from "../src/local/server.js";
import type { LocalAppDeps, LocalAppEnv } from "../src/local/http.js";
import { registerHitlRoutes } from "../src/local/routes/hitl.js";
import { ApprovalBroker } from "../src/session/hitl/approval/index.js";
import { DelegationService } from "../src/session/delegation/index.js";
import { healInterruptedSessionTools } from "../src/session/history/history.js";
import { readHitlPending } from "../src/session/hitl/pending.js";
import { AskUserBroker } from "../src/session/tools/ask-user.js";

it("GET /attention exposes busy_turns phase and sources", async () => {
  const deps = {
    chats: {
      busyTurns: (userId: string) =>
        userId === "u1"
          ? [
              {
                agentId: "personal-assistant",
                phase: "wake" as const,
                sources: [
                  {
                    name: "前端",
                    status: "completed",
                    agentId: "loc-fe",
                    kind: "delegation" as const,
                  },
                ],
              },
            ]
          : [],
    },
    approvals: { restoreUser() {}, listPending: () => [] },
    askUser: { restoreUser() {}, listPending: () => [] },
    delegation: { findNestingParent: () => undefined },
  } as unknown as LocalAppDeps;
  const app = new Hono<LocalAppEnv>();
  registerHitlRoutes(app, deps);
  const res = await app.request("/attention?user_id=u1", {
    headers: { authorization: "Bearer token" },
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    busy_agent_ids: ["personal-assistant"],
    busy_turns: [
      {
        agent_id: "personal-assistant",
        phase: "wake",
        sources: [
          {
            name: "前端",
            status: "completed",
            agent_id: "loc-fe",
            kind: "delegation",
          },
        ],
      },
    ],
  });
});

it("GET /turn-progress streams dirty snapshot then done", async () => {
  type Listener = (event: {
    type: "dirty" | "done";
    agentId: string;
    phase?: "prompt" | "wake";
  }) => void;
  const listeners = new Set<Listener>();
  const deps = {
    chats: {
      busyTurns: () => [
        {
          agentId: "personal-assistant",
          phase: "wake" as const,
          sources: [{ name: "前端", kind: "delegation" as const }],
        },
      ],
      subscribeTurnProgress(_userId: string, listener: Listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    approvals: { restoreUser() {}, listPending: () => [] },
    askUser: { restoreUser() {}, listPending: () => [] },
    delegation: { findNestingParent: () => undefined },
  } as unknown as LocalAppDeps;
  const app = new Hono<LocalAppEnv>();
  registerHitlRoutes(app, deps);

  const res = await app.request(
    "/turn-progress?user_id=u1&agent_id=personal-assistant",
    { headers: { authorization: "Bearer token" } },
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && !buffer.includes("event: dirty")) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  expect(buffer).toContain("event: dirty");
  expect(buffer).toContain('"phase":"wake"');
  for (const listener of listeners) {
    listener({ type: "done", agentId: "personal-assistant" });
  }
  while (Date.now() < deadline && !buffer.includes("event: done")) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  expect(buffer).toContain("event: done");
  await reader.cancel();
});

it("GET /attention returns empty snapshot for a user", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-attention-"));
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  const headers = { authorization: "Bearer token" };
  try {
    const empty = await fetch(`${local.url}/attention?user_id=u1`, { headers });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({
      busy_agent_ids: [],
      busy_turns: [],
      approvals: [],
      ask_users: [],
    });
    expect((await fetch(`${local.url}/attention`, { headers })).status).toBe(400);
    expect((await fetch(`${local.url}/attention?user_id=u1`)).status).toBe(401);
  } finally {
    await local.close();
  }
});

it("GET /attention surfaces nested child approval to busy parent", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-attention-nested-"));
  const approvals = new ApprovalBroker(root);
  const askUser = new AskUserBroker(root);
  const delegation = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => ({
      providerId: "ollama",
      templateId: "ollama",
      modelId: "m",
      apiKey: "k",
      baseUrl: "http://127.0.0.1:11434/v1",
      kind: "ollama" as const,
    }),
    approvals,
    askUser,
  });
  const deps = {
    chats: {
      busyTurns: (userId: string) =>
        userId === "u1"
          ? [{ agentId: "personal-assistant", phase: "prompt" as const, sources: [] }]
          : [],
    },
    approvals,
    askUser,
    delegation,
  } as unknown as LocalAppDeps;
  const app = new Hono<LocalAppEnv>();
  registerHitlRoutes(app, deps);

  void approvals.request({
    userId: "u1",
    agentId: "weather",
    toolCallId: "call-nested",
    toolName: "bash",
    args: { command: "pwd" },
    origin: "delegation",
    parentAgentId: "personal-assistant",
    taskId: "task-1",
  });
  const unmark = delegation.markNested("u1", "personal-assistant", "weather");

  const res = await app.request("/attention?user_id=u1", {
    headers: { authorization: "Bearer token" },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    approvals: Array<{ agent_id: string; tool_call_id: string }>;
  };
  expect(body.approvals).toEqual([
    expect.objectContaining({
      agent_id: "personal-assistant",
      origin_agent_id: "weather",
      parent_agent_id: "personal-assistant",
      tool_call_id: "call-nested",
    }),
  ]);
  unmark();
});

it("GET /attention keeps visit-origin child approval on child while nested", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-attention-visit-"));
  const approvals = new ApprovalBroker(root);
  const askUser = new AskUserBroker(root);
  const delegation = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => ({
      providerId: "ollama",
      templateId: "ollama",
      modelId: "m",
      apiKey: "k",
      baseUrl: "http://127.0.0.1:11434/v1",
      kind: "ollama" as const,
    }),
    approvals,
    askUser,
  });
  const deps = {
    chats: {
      busyTurns: (userId: string) =>
        userId === "u1"
          ? [{ agentId: "personal-assistant", phase: "prompt" as const, sources: [] }]
          : [],
    },
    approvals,
    askUser,
    delegation,
  } as unknown as LocalAppDeps;
  const app = new Hono<LocalAppEnv>();
  registerHitlRoutes(app, deps);

  void approvals.request({
    userId: "u1",
    agentId: "weather",
    toolCallId: "call-visit",
    toolName: "bash",
    args: { command: "pwd" },
    origin: "visit",
  });
  const unmark = delegation.markNested("u1", "personal-assistant", "weather");

  const res = await app.request("/attention?user_id=u1", {
    headers: { authorization: "Bearer token" },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    approvals: Array<{ agent_id: string; tool_call_id: string }>;
  };
  expect(body.approvals).toEqual([
    expect.objectContaining({
      agent_id: "weather",
      tool_call_id: "call-visit",
    }),
  ]);
  unmark();
});

it("persists live approvals to disk", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-hitl-disk-"));
  const broker = new ApprovalBroker(root);
  const pending = broker.request({
    userId: "u1",
    agentId: "weather",
    toolCallId: "call-1",
    toolName: "bash",
    args: { command: "pwd" },
  });
  const listed = broker.listPending("u1");
  expect(listed).toHaveLength(1);
  expect(readHitlPending(root, "u1").approvals).toHaveLength(1);
  expect(broker.decide(listed[0]!.id, false)).toBe(true);
  await expect(pending).resolves.toBe(false);
  expect(readHitlPending(root, "u1").approvals).toHaveLength(0);
});

it("skips healing tool calls that still have actionable pending", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-heal-skip-"));
  const cwd = path.join(root, "cwd");
  const sessionDir = path.join(root, "sessions");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  const manager = SessionManager.create(cwd, sessionDir);
  manager.appendMessage({
    role: "assistant",
    content: [
      { type: "toolCall", id: "keep", name: "bash", arguments: { command: "pwd" } },
      { type: "toolCall", id: "drop", name: "bash", arguments: { command: "ls" } },
    ],
    timestamp: Date.now(),
  } as never);

  expect(healInterruptedSessionTools(manager, { skipToolCallIds: new Set(["keep"]) })).toBe(1);
  expect(healInterruptedSessionTools(manager, { skipToolCallIds: new Set(["keep"]) })).toBe(0);
});

it("restores orphan approval only when toolCall still dangling", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-orphan-"));
  const userId = "u1";
  const agentId = "weather";
  const visitRoot = path.join(root, "users", userId, "agents", agentId);
  const cwd = path.join(visitRoot, "cwd");
  const sessionDir = path.join(visitRoot, "sessions");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  const manager = SessionManager.create(cwd, sessionDir);
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "call-orph", name: "bash", arguments: { command: "pwd" } }],
    timestamp: Date.now(),
  } as never);

  const live = new ApprovalBroker(root);
  void live.request({
    userId,
    agentId,
    toolCallId: "call-orph",
    toolName: "bash",
    args: { command: "pwd" },
  });
  const id = live.listPending(userId)[0]!.id;

  const restarted = new ApprovalBroker(root);
  const pending = restarted.listPending(userId);
  expect(pending).toHaveLength(1);
  expect(pending[0]!.id).toBe(id);
  expect(restarted.decide(id, true)).toBe(true);
  expect(restarted.listPending(userId)).toHaveLength(0);

  const after = SessionManager.continueRecent(cwd, sessionDir);
  expect(healInterruptedSessionTools(after)).toBe(0);
});

it("ask_user broker persists and restores orphans", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-ask-orph-"));
  const userId = "u1";
  const agentId = "personal-assistant";
  const visitRoot = path.join(root, "users", userId, "personal-assistant");
  const cwd = path.join(visitRoot, "cwd");
  const sessionDir = path.join(visitRoot, "sessions");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  const manager = SessionManager.create(cwd, sessionDir);
  manager.appendMessage({
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "ask-1",
        name: "ask_user",
        arguments: {
          questions: [{ question: "选哪个？", options: [{ title: "A" }], allowMultiple: false }],
        },
      },
    ],
    timestamp: Date.now(),
  } as never);

  const live = new AskUserBroker(root);
  void live.request({
    userId,
    agentId,
    toolCallId: "ask-1",
    questions: [
      {
        question: "选哪个？",
        options: [{ title: "A" }],
        allowMultiple: false,
      },
    ],
  });
  const id = live.listPending(userId)[0]!.id;

  const restarted = new AskUserBroker(root);
  expect(restarted.listPending(userId)).toHaveLength(1);
  expect(
    restarted.answer(id, {
      kind: "answers",
      items: [{ kind: "selection", selections: ["A"] }],
    }),
  ).toBe(true);
  expect(restarted.listPending(userId)).toHaveLength(0);
});
