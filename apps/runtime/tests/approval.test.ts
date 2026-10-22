import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { readState } from "../src/local/user/state.js";
import { ApprovalBroker, createApprovalExtension } from "../src/session/hitl/approval.js";

async function bindToolHandler(broker: ApprovalBroker, userId = "patient", agentId = "agent") {
  let handler: ((event: Record<string, unknown>, context: { signal?: AbortSignal }) => Promise<unknown>) | undefined;
  const extension = createApprovalExtension(broker, userId, agentId);
  await extension({
    on(event: string, value: typeof handler) {
      if (event === "tool_call") handler = value;
      return vi.fn();
    },
  } as never);
  return handler!;
}

it("lets read-only tools run and asks once for dangerous tools", async () => {
  const broker = new ApprovalBroker();
  const handler = await bindToolHandler(broker);

  expect(await handler({ type: "tool_call", toolCallId: "read-1", toolName: "read", input: { path: "a" } }, { signal: undefined })).toBeUndefined();

  const seen = vi.fn();
  broker.subscribe((request) => {
    seen(request);
    broker.decide(request.id, false);
  });
  await expect(handler({ type: "tool_call", toolCallId: "bash-1", toolName: "bash", input: { command: "pwd" } }, { signal: undefined }))
    .resolves.toEqual({ block: true, reason: "用户拒绝了这次工具调用" });
  expect(seen).toHaveBeenCalledWith(expect.objectContaining({
    userId: "patient",
    agentId: "agent",
    toolName: "bash",
  }));
});

it("lets write, edit, web_fetch, and todo run without approval", async () => {
  const broker = new ApprovalBroker();
  const handler = await bindToolHandler(broker);
  const seen = vi.fn();
  broker.subscribe(seen);
  await expect(
    handler({ type: "tool_call", toolCallId: "write-1", toolName: "write", input: { path: "a" } }, { signal: undefined }),
  ).resolves.toBeUndefined();
  await expect(
    handler({ type: "tool_call", toolCallId: "edit-1", toolName: "edit", input: { path: "a" } }, { signal: undefined }),
  ).resolves.toBeUndefined();
  await expect(
    handler(
      {
        type: "tool_call",
        toolCallId: "fetch-1",
        toolName: "web_fetch",
        input: { url: "https://example.com" },
      },
      { signal: undefined },
    ),
  ).resolves.toBeUndefined();
  await expect(
    handler(
      {
        type: "tool_call",
        toolCallId: "todo-1",
        toolName: "todo",
        input: { action: "add", text: "写测试" },
      },
      { signal: undefined },
    ),
  ).resolves.toBeUndefined();
  expect(seen).not.toHaveBeenCalled();
});

it("lets session-scoped command allow skip later bash approvals for the same agent", async () => {
  const broker = new ApprovalBroker();
  const handler = await bindToolHandler(broker);
  const seen = vi.fn();
  broker.subscribe((request) => {
    seen(request);
    broker.decide(request.id, true, "session");
  });

  await expect(
    handler({ type: "tool_call", toolCallId: "bash-1", toolName: "bash", input: { command: "pwd" } }, { signal: undefined }),
  ).resolves.toBeUndefined();
  await expect(
    handler({ type: "tool_call", toolCallId: "bash-2", toolName: "bash", input: { command: "ls" } }, { signal: undefined }),
  ).resolves.toBeUndefined();
  expect(seen).toHaveBeenCalledTimes(1);
});

it("clears session-scoped command allow for an agent", async () => {
  const broker = new ApprovalBroker();
  const handler = await bindToolHandler(broker);
  broker.subscribe((request) => broker.decide(request.id, true, "session"));
  await handler({ type: "tool_call", toolCallId: "bash-1", toolName: "bash", input: { command: "pwd" } }, { signal: undefined });
  broker.clearSessionAllow("patient", "agent");

  const seen = vi.fn();
  broker.subscribe((request) => {
    seen(request);
    broker.decide(request.id, true);
  });
  await expect(
    handler({ type: "tool_call", toolCallId: "bash-2", toolName: "bash", input: { command: "ls" } }, { signal: undefined }),
  ).resolves.toBeUndefined();
  expect(seen).toHaveBeenCalledTimes(1);
});

it("keeps agent-scoped command allow after session allow is cleared", async () => {
  const broker = new ApprovalBroker();
  const handler = await bindToolHandler(broker);
  const seen = vi.fn();
  broker.subscribe((request) => {
    seen(request);
    broker.decide(request.id, true, "agent");
  });

  await expect(
    handler({ type: "tool_call", toolCallId: "bash-1", toolName: "bash", input: { command: "pwd" } }, { signal: undefined }),
  ).resolves.toBeUndefined();
  broker.clearSessionAllow("patient", "agent");
  await expect(
    handler({ type: "tool_call", toolCallId: "bash-2", toolName: "bash", input: { command: "ls" } }, { signal: undefined }),
  ).resolves.toBeUndefined();
  expect(seen).toHaveBeenCalledTimes(1);
});

it("persists session and agent command allow in state.json", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-approval-state-"));
  const broker = new ApprovalBroker(root);
  const handler = await bindToolHandler(broker);
  const unsubSession = broker.subscribe((request) => broker.decide(request.id, true, "session"));
  await handler({ type: "tool_call", toolCallId: "bash-1", toolName: "bash", input: { command: "pwd" } }, { signal: undefined });
  expect(readState(root, "patient").commandAllow).toEqual({ agent: "session" });
  unsubSession();
  broker.clearSessionAllow("patient", "agent");
  expect(readState(root, "patient").commandAllow).toEqual({});

  broker.subscribe((request) => broker.decide(request.id, true, "agent"));
  await handler({ type: "tool_call", toolCallId: "bash-2", toolName: "bash", input: { command: "ls" } }, { signal: undefined });
  expect(readState(root, "patient").commandAllow).toEqual({ agent: "agent" });
  broker.clearSessionAllow("patient", "agent");
  expect(readState(root, "patient").commandAllow).toEqual({ agent: "agent" });
});

it("releases a pending approval when the prompt is aborted", async () => {
  const broker = new ApprovalBroker();
  const controller = new AbortController();
  let id = "";
  broker.subscribe((request) => {
    id = request.id;
    controller.abort();
  });
  await expect(broker.request({
    userId: "patient",
    agentId: "agent",
    toolCallId: "call-1",
    toolName: "mcp__hospital__write",
    args: {},
  }, controller.signal)).resolves.toBeUndefined();
  expect(broker.decide(id, true)).toBe(false);
});
