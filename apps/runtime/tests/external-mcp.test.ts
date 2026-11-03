import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  ROOM_DELEGATION_TOOLS,
  SINGLE_ONLY_DELEGATION_TOOLS,
} from "../src/session/context/tool-policy.js";
import type { DelegationTask } from "../src/session/delegation/types.js";
import {
  delegationTools,
  expectedMcpDelegationToolNames,
  type DelegationBridge,
} from "../src/session/external/mcp/delegation-tools.js";
import { startExternalMcpServer, type McpTool } from "../src/session/external/mcp/server.js";

let root = "";
let open: Array<{ close: () => Promise<void> }> = [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-mcp-"));
  open = [];
});

afterEach(async () => {
  for (const server of open) await server.close().catch(() => undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

function task(overrides: Partial<DelegationTask> = {}): DelegationTask {
  return {
    id: "t-1",
    userId: "guest",
    fromAgentId: "a1",
    toAgentId: "a2",
    toAgentName: "Weaty",
    brief: "查天气",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    wait: false,
    seen: false,
    notified: false,
    ...overrides,
  };
}

/** 假委托服务：只记调用，不真的开子会话。 */
function bridge(overrides: Partial<DelegationBridge> = {}): DelegationBridge & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async delegateFanout(input) {
      calls.push(input);
      return { tasks: [task()], texts: ["晴"] };
    },
    getTask() {
      return task();
    },
    listTasks() {
      return [task({ id: "t-2", status: "completed", resultSummary: "写完了" })];
    },
    cancel(taskId, userId) {
      calls.push({ op: "cancel", taskId, userId });
      return task({ id: taskId, status: "cancelled", error: "用户已取消" });
    },
    async steer(input) {
      calls.push(input);
      return { queued: true, task: task() };
    },
    async listRecruited() {
      return [
        {
          agentId: "a1",
          name: "私人助理",
          role: "协调",
          background: "",
          remark: "",
        },
        {
          agentId: "a2",
          name: "Weaty",
          role: "天气助手",
          background: "天气预报与出行建议",
          remark: "天气",
        },
      ];
    },
    ...overrides,
  };
}

async function call(server: { url: string; headers: Record<string, string> }, method: string, params?: unknown) {
  const response = await fetch(server.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...server.headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await response.json()) as { result?: Record<string, any>; error?: { code: number } };
}

async function callTool(
  server: { url: string; headers: Record<string, string> },
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const response = await call(server, "tools/call", { name, arguments: args });
  return (response.result?.content?.[0]?.text ?? "") as string;
}

async function start(tools: McpTool[], token = "tok") {
  const server = await startExternalMcpServer({ tools, token });
  open.push(server);
  return server;
}

it("握手与工具清单：initialize / tools/list 走标准 JSON-RPC", async () => {
  const server = await start([
    { name: "ping_tool", description: "p", inputSchema: { type: "object", properties: {} }, handler: async () => ({ text: "pong" }) },
  ]);

  const init = await call(server, "initialize", { protocolVersion: "2025-06-18" });
  expect(init.result?.serverInfo?.name).toBe("agentup");
  const list = await call(server, "tools/list");
  expect(list.result?.tools?.map((tool: { name: string }) => tool.name)).toEqual(["ping_tool"]);
});

it("没有 token 的请求一律 401", async () => {
  const server = await start([], "secret");
  const response = await fetch(server.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(response.status).toBe(401);
});

it("tools/call 走通 handler，异常变成 isError 而不炸连接", async () => {
  const server = await start([
    {
      name: "boom",
      description: "b",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        throw new Error("内部炸了");
      },
    },
    { name: "ok", description: "o", inputSchema: { type: "object", properties: {} }, handler: async () => ({ text: "好" }) },
  ]);

  expect(await callTool(server, "ok", {})).toBe("好");
  const failed = await call(server, "tools/call", { name: "boom", arguments: {} });
  expect(failed.result?.isError).toBe(true);
  expect(failed.result?.content?.[0]?.text).toContain("内部炸了");
  const missing = await call(server, "tools/call", { name: "nope", arguments: {} });
  expect(missing.error?.code).toBe(-32602);
});

it("非群聊挂载 agent_search；群聊不挂", async () => {
  const service = bridge();
  const room = await start(delegationTools({ service, userId: "guest", agentId: "a1" }));
  const roomList = await call(room, "tools/list");
  expect(roomList.result?.tools?.map((tool: { name: string }) => tool.name)).toEqual(
    expectedMcpDelegationToolNames({}),
  );

  const group = await start(
    delegationTools({ service, userId: "guest", agentId: "a1", groupId: "g1" }),
  );
  const groupList = await call(group, "tools/list");
  expect(groupList.result?.tools?.map((tool: { name: string }) => tool.name)).toEqual(
    expectedMcpDelegationToolNames({ groupId: "g1" }),
  );
});

/**
 * Pi 房间协调工具升级时，MCP 必须同步挂载。
 * 权威源：`ROOM_DELEGATION_TOOLS`（+ 单聊 `SINGLE_ONLY_DELEGATION_TOOLS`）。
 * 只改 Pi / tool-policy、忘了 MCP → 本测变红。
 */
it("MCP 委托工具与 Pi ROOM_DELEGATION_TOOLS 完备对齐", () => {
  const service = bridge();
  const singleNames = delegationTools({ service, userId: "guest", agentId: "a1" }).map((tool) => tool.name);
  const groupNames = delegationTools({
    service,
    userId: "guest",
    agentId: "a1",
    groupId: "g1",
  }).map((tool) => tool.name);

  expect(singleNames).toEqual([...SINGLE_ONLY_DELEGATION_TOOLS, ...ROOM_DELEGATION_TOOLS]);
  expect(groupNames).toEqual([...ROOM_DELEGATION_TOOLS]);
  expect(singleNames).toEqual(expectedMcpDelegationToolNames({}));
  expect(groupNames).toEqual(expectedMcpDelegationToolNames({ groupId: "g1" }));
  // 停专员的主路径必须在群聊 MCP 上（否则模型会去 kill 进程）
  expect(groupNames).toContain("cancel_delegation");
  expect(groupNames).toContain("resolve_delegation_update");
  // 方案 D：技能不走 MCP
  expect(singleNames.some((name) => name.startsWith("skill_"))).toBe(false);
  expect(groupNames.some((name) => name.startsWith("skill_"))).toBe(false);
});

it("agent_search：按 query 检索花名册，排除自己", async () => {
  const service = bridge();
  const server = await start(delegationTools({ service, userId: "guest", agentId: "a1" }));

  const hit = await callTool(server, "agent_search", { query: "天气" });
  // 名片优先展示 remark（「天气」），并带 agent_id
  expect(hit).toContain("天气");
  expect(hit).toContain("a2");
  expect(hit).toContain("天气助手");
  expect(hit).not.toContain("私人助理");

  const needQuery = await callTool(server, "agent_search", { query: "   " });
  expect(needQuery).toContain("query is required");

  const miss = await callTool(server, "agent_search", { query: "量子金融衍生品" });
  expect(miss).toContain("No recruited agents matched");
});

it("delegate_to_agent：默认异步，回 task_id 与专员名", async () => {
  const service = bridge();
  const server = await start(delegationTools({ service, userId: "guest", agentId: "a1" }));
  const text = await callTool(server, "delegate_to_agent", { agent_id: "a2", brief: "查天气" });

  expect(service.calls[0]).toMatchObject({
    userId: "guest",
    fromAgentId: "a1",
    items: [{ toAgentId: "a2", brief: "查天气" }],
  });
  expect(service.calls[0]).not.toHaveProperty("wait");
  expect(text).toContain("t-1");
  expect(text).toContain("Weaty");
  // 失败文案要写明"不要自己重做"，否则主 agent 会自己补救（§12.7）
  expect(text).toContain("do not redo the work yourself");
});

it("delegate_to_agent：扇出与 wait 透传，缺参数直接回错误", async () => {
  const service = bridge();
  const server = await start(delegationTools({ service, userId: "guest", agentId: "a1" }));

  await callTool(server, "delegate_to_agent", {
    tasks: [
      { agent_id: "a2", brief: "b1" },
      { agent_id: "a3", brief: "b2" },
    ],
    wait: true,
  });
  expect(service.calls[0]).toMatchObject({ wait: true, items: [{ toAgentId: "a2" }, { toAgentId: "a3" }] });

  const bad = await call(server, "tools/call", { name: "delegate_to_agent", arguments: {} });
  expect(bad.result?.isError).toBe(true);
});

it("check_delegation：按 id 查，不认识的 id 不越权", async () => {
  const service = bridge({ getTask: () => undefined });
  const server = await start(delegationTools({ service, userId: "guest", agentId: "a1" }));

  const missing = await call(server, "tools/call", { name: "check_delegation", arguments: { task_id: "x" } });
  expect(missing.result?.isError).toBe(true);
  expect(missing.result?.content?.[0]?.text).toContain("not found");

  const listed = await callTool(server, "check_delegation", {});
  expect(listed).toContain("t-2");
});

it("check_delegation：同一账号的其他 Agent 也不能读取任务", async () => {
  const service = bridge({ getTask: () => task({ fromAgentId: "other-agent" }) });
  const server = await start(delegationTools({ service, userId: "guest", agentId: "a1" }));

  const response = await call(server, "tools/call", {
    name: "check_delegation",
    arguments: { task_id: "t-1" },
  });

  expect(response.result?.isError).toBe(true);
  expect(response.result?.content?.[0]?.text).toContain("not found");
});

it("steer_delegation：排上队说明保留已做的工作，被挡下时说清原因", async () => {
  const queued = bridge();
  const server = await start(delegationTools({ service: queued, userId: "guest", agentId: "a1" }));
  const text = await callTool(server, "steer_delegation", { task_id: "t-1", note: "换个方法" });
  expect(text).toContain("Steering queued");
  expect(queued.calls[0]).toMatchObject({ taskId: "t-1", note: "换个方法", userId: "guest", fromAgentId: "a1" });

  const blocked = bridge({
    async steer() {
      return { queued: false, reason: "waiting_user", task: task() };
    },
  });
  const blockedServer = await start(delegationTools({ service: blocked, userId: "guest", agentId: "a1" }));
  const blockedText = await callTool(blockedServer, "steer_delegation", { task_id: "t-1", note: "x" });
  expect(blockedText).toContain("waiting_user");
});

it("cancel_delegation：按 task_id 停专员，不靠杀进程", async () => {
  const service = bridge();
  const server = await start(delegationTools({ service, userId: "guest", agentId: "a1" }));
  const text = await callTool(server, "cancel_delegation", { task_id: "t-1" });
  expect(text).toContain("Delegation cancelled");
  expect(text).toContain("t-1");
  expect(service.calls[0]).toMatchObject({ op: "cancel", taskId: "t-1", userId: "guest" });

  const missing = bridge({
    cancel() {
      throw new Error("委托任务不存在");
    },
  });
  const missingServer = await start(delegationTools({ service: missing, userId: "guest", agentId: "a1" }));
  const failed = await call(missingServer, "tools/call", {
    name: "cancel_delegation",
    arguments: { task_id: "nope" },
  });
  expect(failed.result?.isError).toBe(true);
  expect(failed.result?.content?.[0]?.text).toContain("委托任务不存在");
});

it("resolve_delegation_update：cancel / keep 走通；非进行中任务拒绝", async () => {
  const service = bridge({
    listTasks() {
      return [task({ id: "t-1", status: "running" })];
    },
  });
  const server = await start(delegationTools({ service, userId: "guest", agentId: "a1" }));

  const cancelled = await callTool(server, "resolve_delegation_update", {
    task_id: "t-1",
    action: "cancel",
  });
  expect(cancelled).toContain("Delegation cancelled");
  expect(service.calls.some((call) => (call as { op?: string }).op === "cancel")).toBe(true);

  const kept = await callTool(server, "resolve_delegation_update", {
    task_id: "t-1",
    action: "keep",
    reason: "本条与该任务无关",
  });
  expect(kept).toContain("Kept task unchanged");

  const closed = bridge({
    listTasks() {
      return [task({ id: "t-1", status: "completed" })];
    },
  });
  const closedServer = await start(delegationTools({ service: closed, userId: "guest", agentId: "a1" }));
  const rejected = await call(closedServer, "tools/call", {
    name: "resolve_delegation_update",
    arguments: { task_id: "t-1", action: "cancel" },
  });
  expect(rejected.result?.isError).toBe(true);
  const rejectedText = String(rejected.result?.content?.[0]?.text ?? "");
  expect(rejectedText).toContain("not an in-progress delegation");
  expect(rejectedText).toMatch(/do not call|skip|check_delegation|delegate_to_agent/i);
});
