import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { ApprovalBroker, createApprovalExtension } from "../src/session/hitl/approval/index.js";
import { DelegationService, DelegationStore } from "../src/session/delegation/index.js";
import {
  CANCEL_DELEGATION_TOOL,
  CHECK_DELEGATION_TOOL,
  DELEGATE_TO_AGENT_TOOL,
  AGENT_SEARCH_TOOL,
  createDelegateExtension,
} from "../src/session/tools/index.js";
import { buildSessionPlan } from "../src/session/plan.js";
import { PERSONAL_ASSISTANT_ID } from "../src/local/assistant/personal-assistant.js";
import { getDelegationAllow, setDelegationAllow } from "../src/local/user/state.js";

it("stores delegation tasks and lists unseen completed ones", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deleg-store-"));
  const store = new DelegationStore(root);
  const task = store.create({
    userId: "patient",
    fromAgentId: PERSONAL_ASSISTANT_ID,
    toAgentId: "weather",
    toAgentName: "天气",
    brief: "查天气",
    wait: false,
  });
  store.update(task.id, { status: "completed", resultSummary: "晴" });
  const unseen = store.list("patient", { unseenOnly: true, status: "completed" });
  expect(unseen).toHaveLength(1);
  expect(unseen[0]?.resultSummary).toBe("晴");
  store.update(task.id, { seen: true });
  expect(store.list("patient", { unseenOnly: true })).toHaveLength(0);
});

it("adds delegation tools for personal and recruited visits", () => {
  const personal = buildSessionPlan(
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
    testModel(),
  );
  expect(personal.tools).toContain(AGENT_SEARCH_TOOL);
  expect(personal.tools).toContain(DELEGATE_TO_AGENT_TOOL);
  expect(personal.tools).toContain(CHECK_DELEGATION_TOOL);
  expect(personal.tools).toContain(CANCEL_DELEGATION_TOOL);

  const recruited = buildSessionPlan(
    {
      kind: "recruited",
      userId: "u",
      agentId: "weather",
      root: "/tmp/w",
      packageVersion: 1,
      packageDigest: "d",
      tools: [],
      modelCapabilities: [],
      projectTrust: "granted",
    },
    testModel(),
  );
  expect(recruited.tools).toContain(DELEGATE_TO_AGENT_TOOL);
});

it("asks approval for delegate_to_agent and remembers session allow", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deleg-allow-"));
  const broker = new ApprovalBroker(root);
  let handler:
    | ((event: Record<string, unknown>, context: { signal?: AbortSignal }) => Promise<unknown>)
    | undefined;
  const extension = createApprovalExtension(broker, "patient", PERSONAL_ASSISTANT_ID);
  await extension({
    on(event: string, value: typeof handler) {
      if (event === "tool_call") handler = value;
      return vi.fn();
    },
  } as never);

  broker.subscribe((request) => {
    expect(request.toolName).toBe(DELEGATE_TO_AGENT_TOOL);
    broker.decide(request.id, true, "session");
  });
  await expect(
    handler!(
      {
        type: "tool_call",
        toolCallId: "d1",
        toolName: DELEGATE_TO_AGENT_TOOL,
        input: { agent_id: "weather", brief: "查天气" },
      },
      { signal: undefined },
    ),
  ).resolves.toBeUndefined();
  expect(getDelegationAllow(root, "patient", "weather")).toBe("session");

  const seen = vi.fn();
  broker.subscribe(seen);
  await expect(
    handler!(
      {
        type: "tool_call",
        toolCallId: "d2",
        toolName: DELEGATE_TO_AGENT_TOOL,
        input: { agent_id: "weather", brief: "再查" },
      },
      { signal: undefined },
    ),
  ).resolves.toBeUndefined();
  expect(seen).not.toHaveBeenCalled();
});

it("agent-scoped delegation allow lets the from agent call anyone", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deleg-open-"));
  const broker = new ApprovalBroker(root);
  let handler:
    | ((event: Record<string, unknown>, context: { signal?: AbortSignal }) => Promise<unknown>)
    | undefined;
  const extension = createApprovalExtension(broker, "patient", PERSONAL_ASSISTANT_ID);
  await extension({
    on(event: string, value: typeof handler) {
      if (event === "tool_call") handler = value;
      return vi.fn();
    },
  } as never);

  broker.subscribe((request) => {
    broker.decide(request.id, true, "agent");
  });
  await expect(
    handler!(
      {
        type: "tool_call",
        toolCallId: "d1",
        toolName: DELEGATE_TO_AGENT_TOOL,
        input: { agent_id: "weather", brief: "查天气" },
      },
      { signal: undefined },
    ),
  ).resolves.toBeUndefined();
  expect(getDelegationAllow(root, "patient", PERSONAL_ASSISTANT_ID)).toBe("agent");
  expect(getDelegationAllow(root, "patient", "weather")).toBeUndefined();

  const seen = vi.fn();
  broker.subscribe(seen);
  await expect(
    handler!(
      {
        type: "tool_call",
        toolCallId: "d2",
        toolName: DELEGATE_TO_AGENT_TOOL,
        input: { agent_id: "coder", brief: "写代码" },
      },
      { signal: undefined },
    ),
  ).resolves.toBeUndefined();
  expect(seen).not.toHaveBeenCalled();

  // 新对话清掉 session，不影响 agent 级「可调任何人」
  broker.clearSessionAllow("patient", PERSONAL_ASSISTANT_ID);
  await expect(
    handler!(
      {
        type: "tool_call",
        toolCallId: "d3",
        toolName: DELEGATE_TO_AGENT_TOOL,
        input: { agent_id: "researcher", brief: "调研" },
      },
      { signal: undefined },
    ),
  ).resolves.toBeUndefined();
  expect(seen).not.toHaveBeenCalled();
  expect(getDelegationAllow(root, "patient", PERSONAL_ASSISTANT_ID)).toBe("agent");
});

it("enriches delegate approval args with agent_name for the UI", async () => {
  const broker = new ApprovalBroker();
  let handler:
    | ((event: Record<string, unknown>, context: { signal?: AbortSignal }) => Promise<unknown>)
    | undefined;
  const extension = createApprovalExtension(broker, "patient", PERSONAL_ASSISTANT_ID, {
    resolveDelegationLabel: async (toAgentId) =>
      toAgentId === "weather" ? "天气助手" : undefined,
  });
  await extension({
    on(event: string, value: typeof handler) {
      if (event === "tool_call") handler = value;
      return vi.fn();
    },
  } as never);

  const seen = vi.fn();
  broker.subscribe((request) => {
    seen(request.args);
    broker.decide(request.id, true, "once");
  });
  await handler!(
    {
      type: "tool_call",
      toolCallId: "d-name",
      toolName: DELEGATE_TO_AGENT_TOOL,
      input: { agent_id: "weather", brief: "查天气" },
    },
    { signal: undefined },
  );
  expect(seen).toHaveBeenCalledWith({
    agent_id: "weather",
    agent_name: "天气助手",
    brief: "查天气",
  });
});

it("enriches fan-out approval args and grants session for each target", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deleg-fan-"));
  const broker = new ApprovalBroker(root);
  let handler:
    | ((event: Record<string, unknown>, context: { signal?: AbortSignal }) => Promise<unknown>)
    | undefined;
  const extension = createApprovalExtension(broker, "patient", PERSONAL_ASSISTANT_ID, {
    resolveDelegationLabel: async (toAgentId) =>
      toAgentId === "weather" ? "天气" : toAgentId === "coder" ? "码农" : toAgentId,
  });
  await extension({
    on(event: string, value: typeof handler) {
      if (event === "tool_call") handler = value;
      return vi.fn();
    },
  } as never);

  const seen = vi.fn();
  broker.subscribe((request) => {
    seen(request.args);
    broker.decide(request.id, true, "session");
  });
  await handler!(
    {
      type: "tool_call",
      toolCallId: "d-fan",
      toolName: DELEGATE_TO_AGENT_TOOL,
      input: {
        tasks: [
          { agent_id: "weather", brief: "查天气" },
          { agent_id: "coder", brief: "写脚本" },
        ],
      },
    },
    { signal: undefined },
  );
  expect(seen).toHaveBeenCalledWith(
    expect.objectContaining({
      agent_name: "天气、码农",
      agent_names: ["天气", "码农"],
      fanout_count: 2,
    }),
  );
  expect(getDelegationAllow(root, "patient", "weather")).toBe("session");
  expect(getDelegationAllow(root, "patient", "coder")).toBe("session");
});

it("lists disk-synced market agents when offline", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deleg-list-"));
  const agentRoot = path.join(root, "users", "patient", "agents", "weather");
  fs.mkdirSync(path.join(agentRoot, "cwd", ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(agentRoot, "instance.json"),
    `${JSON.stringify({
      user_id: "patient",
      agent_id: "weather",
      name: "天气通",
      role: "气象顾问",
      background: "本地天气预报",
      package_version: 1,
      package_digest: "abc",
      project_trust: "granted",
      tools: [],
      model_capabilities: [],
    })}\n`,
  );
  fs.writeFileSync(
    path.join(agentRoot, "cwd", ".pi", "SYSTEM.md"),
    "你是天气通。岗位：气象顾问。\n\n本地天气预报\n",
  );

  const service = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => testModel(),
    approvals: new ApprovalBroker(),
    askUser: { request: vi.fn(), answer: vi.fn(), subscribe: vi.fn() } as never,
  });
  const agents = await service.listRecruited("patient");
  expect(agents).toEqual([
    expect.objectContaining({
      agentId: "weather",
      name: "天气通",
      role: "气象顾问",
      background: "本地天气预报",
      systemText: expect.stringContaining("气象顾问"),
    }),
  ]);
});

it("includes local private agents in the roster alongside disk-synced market agents", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deleg-local-"));
  const now = new Date().toISOString();
  const localId = "loc-abcd1234ef";
  const localRoot = path.join(root, "users", "patient", "agents", localId);
  fs.mkdirSync(path.join(localRoot, "cwd", ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(localRoot, "instance.json"),
    `${JSON.stringify({
      kind: "local",
      user_id: "patient",
      agent_id: localId,
      name: "图图",
      role: "信息图大师",
      background: "根据资料绘制信息图",
      package_version: 1,
      package_digest: "localdigest",
      active_session_id: "main",
      tools: [],
      model_capabilities: ["tools"],
      project_trust: "granted",
      created_at: now,
      updated_at: now,
    })}\n`,
  );
  fs.writeFileSync(
    path.join(localRoot, "cwd", ".pi", "SYSTEM.md"),
    "你是图图。岗位：信息图大师。\n\n根据资料绘制信息图\n",
  );

  const marketRoot = path.join(root, "users", "patient", "agents", "hJsAC7Ph");
  fs.mkdirSync(path.join(marketRoot, "cwd", ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(marketRoot, "instance.json"),
    `${JSON.stringify({
      user_id: "patient",
      agent_id: "hJsAC7Ph",
      package_version: 1,
      package_digest: "m",
      project_trust: "granted",
      tools: [],
      model_capabilities: [],
    })}\n`,
  );
  fs.writeFileSync(
    path.join(marketRoot, "cwd", ".pi", "SYSTEM.md"),
    "你是 Weaty。岗位：气象学家。\n\n天气查询\n",
  );

  const service = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => testModel(),
    approvals: new ApprovalBroker(),
    askUser: { request: vi.fn(), answer: vi.fn(), subscribe: vi.fn() } as never,
  });
  const agents = await service.listRecruited("patient");
  expect(agents.map((item) => item.agentId).sort()).toEqual(["hJsAC7Ph", localId].sort());
  expect(agents.find((item) => item.agentId === localId)).toMatchObject({
    name: "图图",
    role: "信息图大师",
    background: "根据资料绘制信息图",
  });
});

it("registers delegate tools for any visit agent", async () => {
  const names: string[] = [];
  createDelegateExtension(
    {
      listRecruited: vi.fn(),
      delegate: vi.fn(),
      delegateFanout: vi.fn(),
      cancel: vi.fn(),
      getTask: vi.fn(),
      listTasks: vi.fn(),
      acknowledge: vi.fn(),
    } as never,
    "patient",
    "weather",
  )({
    registerTool(tool: { name: string }) {
      names.push(tool.name);
    },
  } as never);
  expect(names).toEqual([
    AGENT_SEARCH_TOOL,
    DELEGATE_TO_AGENT_TOOL,
    CANCEL_DELEGATION_TOOL,
    CHECK_DELEGATION_TOOL,
  ]);
});

it("cancels a running task via AbortController", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deleg-cancel-"));
  const store = new DelegationStore(root);
  const task = store.create({
    userId: "patient",
    fromAgentId: PERSONAL_ASSISTANT_ID,
    toAgentId: "weather",
    toAgentName: "天气",
    brief: "查天气",
    wait: false,
  });
  store.update(task.id, { status: "running" });
  const service = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => testModel(),
    approvals: new ApprovalBroker(),
    askUser: { request: vi.fn(), answer: vi.fn(), subscribe: vi.fn() } as never,
  });
  // 无 controller 时仍可标记 cancelled（排队/落盘恢复场景）
  const cancelled = service.cancel(task.id, "patient");
  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.error).toBe("用户已取消");
});

it("lists tasks filtered by fromAgentId", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deleg-from-"));
  const store = new DelegationStore(root);
  store.create({
    userId: "patient",
    fromAgentId: "personal-assistant",
    toAgentId: "weather",
    toAgentName: "天气",
    brief: "a",
    wait: false,
  });
  store.create({
    userId: "patient",
    fromAgentId: "other",
    toAgentId: "weather",
    toAgentName: "天气",
    brief: "b",
    wait: false,
  });
  const fromPa = store.list("patient", { fromAgentId: "personal-assistant" });
  expect(fromPa).toHaveLength(1);
  expect(fromPa[0]?.brief).toBe("a");
});

it("persists delegation allow in state.json", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deleg-state-"));
  setDelegationAllow(root, "patient", "weather", "session");
  expect(getDelegationAllow(root, "patient", "weather")).toBe("session");
});

it("tracks nesting parent for HITL surface", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deleg-nested-"));
  const service = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => testModel(),
    approvals: new ApprovalBroker(),
    askUser: { request: vi.fn(), answer: vi.fn(), subscribe: vi.fn() } as never,
  });
  expect(service.findNestingParent("patient", "weather")).toBeUndefined();
  const unmark = service.markNested("patient", "personal-assistant", "weather");
  expect(service.isNestedUnder("patient", "personal-assistant", "weather")).toBe(true);
  expect(service.findNestingParent("patient", "weather")).toBe("personal-assistant");
  unmark();
  expect(service.findNestingParent("patient", "weather")).toBeUndefined();
});

function testModel() {
  return {
    providerId: "ollama",
    templateId: "ollama",
    modelId: "m",
    apiKey: "k",
    baseUrl: "http://127.0.0.1:11434/v1",
    kind: "ollama" as const,
  };
}
