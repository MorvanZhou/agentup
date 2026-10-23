import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { readState } from "../src/local/user/state.js";
import { ApprovalBroker, createApprovalExtension } from "../src/session/hitl/approval/index.js";

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

it("lets mcp resource list/read tools run without approval", async () => {
  const broker = new ApprovalBroker();
  const handler = await bindToolHandler(broker);
  const seen = vi.fn();
  broker.subscribe(seen);
  for (const toolName of [
    "read_mcp_resource",
    "list_mcp_resources",
    "list_mcp_resource_templates",
  ]) {
    await expect(
      handler({ type: "tool_call", toolCallId: toolName, toolName, input: {} }, { signal: undefined }),
    ).resolves.toBeUndefined();
  }
  expect(seen).not.toHaveBeenCalled();
});

it("lets write, edit, web_fetch, todo, and get_local_time run without approval", async () => {
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
  await expect(
    handler(
      { type: "tool_call", toolCallId: "clock-1", toolName: "get_local_time", input: {} },
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

  // 同一次对话跨「进程重启」：新 broker 读盘仍跳过审批。
  const restored = new ApprovalBroker(root);
  const restoredHandler = await bindToolHandler(restored);
  const seen = vi.fn();
  restored.subscribe(seen);
  await expect(
    restoredHandler(
      { type: "tool_call", toolCallId: "bash-1b", toolName: "bash", input: { command: "pwd" } },
      { signal: undefined },
    ),
  ).resolves.toBeUndefined();
  expect(seen).not.toHaveBeenCalled();

  restored.clearSessionAllow("patient", "agent");
  expect(readState(root, "patient").commandAllow).toEqual({});

  const again = new ApprovalBroker(root);
  const againHandler = await bindToolHandler(again);
  again.subscribe((request) => again.decide(request.id, true, "agent"));
  await againHandler({ type: "tool_call", toolCallId: "bash-2", toolName: "bash", input: { command: "ls" } }, { signal: undefined });
  expect(readState(root, "patient").commandAllow).toEqual({ agent: "agent" });
  again.clearSessionAllow("patient", "agent");
  expect(readState(root, "patient").commandAllow).toEqual({ agent: "agent" });
});

it("lets session-scoped mcp allow skip later calls for the same tool", async () => {
  const broker = new ApprovalBroker();
  const handler = await bindToolHandler(broker);
  const seen = vi.fn();
  broker.subscribe((request) => {
    seen(request);
    broker.decide(request.id, true, "session");
  });

  await expect(
    handler(
      {
        type: "tool_call",
        toolCallId: "mcp-1",
        toolName: "mcp__hospital__write",
        input: { record: "a" },
      },
      { signal: undefined },
    ),
  ).resolves.toBeUndefined();
  await expect(
    handler(
      {
        type: "tool_call",
        toolCallId: "mcp-2",
        toolName: "mcp__hospital__write",
        input: { record: "b" },
      },
      { signal: undefined },
    ),
  ).resolves.toBeUndefined();
  expect(seen).toHaveBeenCalledTimes(1);

  const other = vi.fn();
  broker.subscribe((request) => {
    other(request);
    broker.decide(request.id, true, "once");
  });
  await expect(
    handler(
      {
        type: "tool_call",
        toolCallId: "mcp-3",
        toolName: "mcp__hospital__read",
        input: {},
      },
      { signal: undefined },
    ),
  ).resolves.toBeUndefined();
  expect(other).toHaveBeenCalledTimes(1);
});

it("persists session and agent mcp allow in state.json and restores after restart", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-approval-mcp-"));
  const broker = new ApprovalBroker(root);
  const handler = await bindToolHandler(broker);
  const unsub = broker.subscribe((request) => broker.decide(request.id, true, "agent"));
  await handler(
    {
      type: "tool_call",
      toolCallId: "mcp-1",
      toolName: "mcp__hospital__write",
      input: {},
    },
    { signal: undefined },
  );
  unsub();
  expect(readState(root, "patient").toolAllow).toEqual({
    agent: { "mcp__hospital__write": "agent" },
  });

  const restored = new ApprovalBroker(root);
  const restoredHandler = await bindToolHandler(restored);
  const seen = vi.fn();
  restored.subscribe(seen);
  await expect(
    restoredHandler(
      {
        type: "tool_call",
        toolCallId: "mcp-2",
        toolName: "mcp__hospital__write",
        input: {},
      },
      { signal: undefined },
    ),
  ).resolves.toBeUndefined();
  expect(seen).not.toHaveBeenCalled();

  restored.clearSessionAllow("patient", "agent");
  expect(readState(root, "patient").toolAllow).toEqual({
    agent: { "mcp__hospital__write": "agent" },
  });
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
