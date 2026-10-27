import { expect, it, vi } from "vitest";

import {
  formatDelegationDispositionPrompt,
  parseDelegationDisposition,
  RESOLVE_DELEGATION_UPDATE_TOOL,
  selectOpenDelegationTaskIds,
  shouldForceDelegationDisposition,
  unresolvedDelegationTaskIds,
} from "../src/session/delegation/disposition.js";
import { createDelegateExtension } from "../src/session/tools/delegate.js";
import type { DelegationTask } from "../src/session/delegation/types.js";

const open = ["task-a", "task-b"];

it("selects only this parent's running and pending delegations", () => {
  expect(
    selectOpenDelegationTaskIds(
      [
        { id: "run", fromAgentId: "parent", status: "running" },
        { id: "auth", fromAgentId: "parent", status: "pending_auth" },
        { id: "done", fromAgentId: "parent", status: "completed" },
        { id: "other", fromAgentId: "child", status: "running" },
      ],
      "parent",
    ),
  ).toEqual(["run", "auth"]);
});

it("forces another turn until each open task is resolved, then stops", () => {
  const resolved = new Set<string>();
  const base = {
    outcome: "completed",
    canContinue: true,
    forces: 0,
    unresolvedTaskIds: unresolvedDelegationTaskIds(open, resolved),
  };
  expect(shouldForceDelegationDisposition(base)).toBe(true);
  expect(shouldForceDelegationDisposition({ ...base, forces: 1 })).toBe(true);
  expect(shouldForceDelegationDisposition({ ...base, forces: 2 })).toBe(false);
  expect(shouldForceDelegationDisposition({ ...base, outcome: "aborted" })).toBe(false);
  resolved.add("task-a");
  resolved.add("task-b");
  expect(
    shouldForceDelegationDisposition({
      ...base,
      unresolvedTaskIds: unresolvedDelegationTaskIds(open, resolved),
    }),
  ).toBe(false);
});

it("rejects a disposition that does not name an open task or omits steer note", () => {
  expect(
    parseDelegationDisposition({
      taskId: "missing",
      action: "keep",
      note: "",
      reason: "unrelated",
      openTaskIds: open,
    }),
  ).toEqual({ ok: false, error: "task_id is not an in-progress delegation this turn: missing" });
  expect(
    parseDelegationDisposition({
      taskId: "task-a",
      action: "steer",
      note: "  ",
      reason: "",
      openTaskIds: open,
    }).ok,
  ).toBe(false);
  const kept = parseDelegationDisposition({
    taskId: "task-a",
    action: "keep",
    note: "",
    reason: "用户在问天气",
    openTaskIds: open,
  });
  expect(kept).toMatchObject({ ok: true, action: "keep", taskId: "task-a" });
});

it("continues the user turn until resolve_delegation_update disposes the running task", async () => {
  const task = {
    id: "task-a",
    userId: "patient",
    fromAgentId: "parent",
    status: "running",
  } as DelegationTask;
  const steer = vi.fn(async () => ({ queued: true as const, task }));
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const tools = new Map<string, { execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }> }>();
  const service = {
    listTasks: () => [task],
    delegationDispositionArmed: () => true,
    steer,
    cancel: vi.fn(),
    delegateFanout: vi.fn(),
    getTask: () => task,
    acknowledge: vi.fn(),
    listRecruited: vi.fn(),
  };
  createDelegateExtension(service as never, "patient", "parent")({
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(event, handler);
      return () => undefined;
    },
    registerTool(tool: { name: string; execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }> }) {
      tools.set(tool.name, tool);
    },
  } as never);

  const start = handlers.get("agent_start")!;
  const settle = handlers.get("agent_before_settle")!;
  start({}, {});
  const event = {
    outcome: "completed",
    entries: [{ type: "message" }],
    context: { canContinue: true },
  };
  const first = await settle(event, {});
  expect(first).toMatchObject({ continue: true });
  expect(JSON.stringify(first)).toContain(RESOLVE_DELEGATION_UPDATE_TOOL);
  expect(formatDelegationDispositionPrompt(["task-a"])).toContain("task-a");

  const tool = tools.get(RESOLVE_DELEGATION_UPDATE_TOOL)!;
  const result = await tool.execute("call", {
    task_id: "task-a",
    action: "steer",
    note: "改成深色背景",
  });
  expect(result.content[0]?.text).toContain("Steering queued");
  expect(steer).toHaveBeenCalledOnce();
  const after = await settle(event, {});
  expect(after).toBeUndefined();
});

it("does not force a disposition on a wake turn", async () => {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  createDelegateExtension(
    {
      listTasks: () => [{ id: "task-a", userId: "patient", fromAgentId: "parent", status: "running" }],
      delegationDispositionArmed: () => false,
      listRecruited: vi.fn(),
    } as never,
    "patient",
    "parent",
  )({
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(event, handler);
      return () => undefined;
    },
    registerTool() {
      return undefined;
    },
  } as never);
  await handlers.get("agent_start")!({}, {});
  const settled = await handlers.get("agent_before_settle")!(
    { outcome: "completed", entries: [], context: { canContinue: true } },
    {},
  );
  expect(settled).toBeUndefined();
});
