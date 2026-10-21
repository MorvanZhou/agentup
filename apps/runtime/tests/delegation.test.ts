import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { ApprovalBroker, createApprovalExtension } from "../src/session/approval.js";
import { DelegationService, DelegationStore } from "../src/session/delegation/index.js";
import {
  CHECK_DELEGATION_TOOL,
  DELEGATE_TO_AGENT_TOOL,
  LIST_RECRUITED_AGENTS_TOOL,
  createDelegateExtension,
} from "../src/session/tools/index.js";
import { buildSessionPlan } from "../src/session/plan.js";
import { PERSONAL_ASSISTANT_ID } from "../src/local/personal-assistant.js";
import { getDelegationAllow, setDelegationAllow } from "../src/local/state.js";

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
  expect(personal.tools).toContain(LIST_RECRUITED_AGENTS_TOOL);
  expect(personal.tools).toContain(DELEGATE_TO_AGENT_TOOL);
  expect(personal.tools).toContain(CHECK_DELEGATION_TOOL);

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

it("lists local recruited agents from instance directories", async () => {
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

it("registers delegate tools for any visit agent", async () => {
  const names: string[] = [];
  createDelegateExtension(
    {
      listRecruited: vi.fn(),
      delegate: vi.fn(),
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
    LIST_RECRUITED_AGENTS_TOOL,
    DELEGATE_TO_AGENT_TOOL,
    CHECK_DELEGATION_TOOL,
  ]);
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
