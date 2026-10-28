import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { PERSONAL_ASSISTANT_ID } from "../src/local/assistant/personal-assistant.js";
import { ApprovalBroker } from "../src/session/hitl/approval/index.js";
import { DelegationService, DelegationStore } from "../src/session/delegation/index.js";
import {
  delegationSteerBlock,
  formatDelegationSteerNote,
  STEER_NOTE_MAX,
} from "../src/session/delegation/steer.js";
import {
  STEER_DELEGATION_TOOL,
  createDelegateExtension,
} from "../src/session/tools/index.js";
import type { AskUserRequest } from "../src/session/tools/ask-user.js";

it("allows steer only while a live run is not waiting on the user", () => {
  expect(
    delegationSteerBlock({ status: "running", live: true, waitingOnUser: false }),
  ).toBeUndefined();
  expect(
    delegationSteerBlock({ status: "running", live: false, waitingOnUser: false }),
  ).toBe("not_started");
  expect(
    delegationSteerBlock({ status: "pending_auth", live: true, waitingOnUser: false }),
  ).toBe("not_started");
  expect(
    delegationSteerBlock({ status: "running", live: true, waitingOnUser: true }),
  ).toBe("waiting_user");
  expect(
    delegationSteerBlock({ status: "completed", live: true, waitingOnUser: false }),
  ).toBe("finished");
  expect(
    delegationSteerBlock({ status: "failed", live: false, waitingOnUser: false }),
  ).toBe("finished");
  expect(
    delegationSteerBlock({ status: "cancelled", live: false, waitingOnUser: false }),
  ).toBe("finished");
});

it("tells the specialist to keep current work when applying a steer note", () => {
  const text = formatDelegationSteerNote("  用简单方法修复  ");
  expect(text).toContain("用简单方法修复");
  expect(text).toContain("do not restart from scratch");
  expect(text).not.toContain("  用简单方法修复  ");
});

it("queues a steer into the live run and leaves the task running", async () => {
  const { service, task, steered } = runningTask();
  const release = service.bindDelegationSteer(task.id, steered);
  const outcome = await service.steer({
    taskId: task.id,
    userId: "patient",
    fromAgentId: PERSONAL_ASSISTANT_ID,
    note: "用简单方法修复和验证",
  });
  expect(outcome).toMatchObject({ queued: true, task: { id: task.id, status: "running" } });
  expect(steered).toHaveBeenCalledOnce();
  expect(steered.mock.calls[0]?.[0]).toContain("用简单方法修复和验证");
  expect(service.getTask(task.id)?.status).toBe("running");
  release();
  const after = await service.steer({
    taskId: task.id,
    userId: "patient",
    fromAgentId: PERSONAL_ASSISTANT_ID,
    note: "再补一条",
  });
  expect(after).toMatchObject({ queued: false, reason: "not_started" });
  expect(steered).toHaveBeenCalledOnce();
});

it("does not steer a specialist who is waiting on the user", async () => {
  const pending: AskUserRequest[] = [];
  const { service, task, steered } = runningTask(pending);
  pending.push({
    id: "ask-1",
    userId: "patient",
    agentId: "weather",
    toolCallId: "tool-1",
    questions: [],
    origin: "delegation",
    taskId: task.id,
  });
  service.bindDelegationSteer(task.id, steered);
  const outcome = await service.steer({
    taskId: task.id,
    userId: "patient",
    fromAgentId: PERSONAL_ASSISTANT_ID,
    note: "先别问了，用简单方法",
  });
  expect(outcome).toMatchObject({ queued: false, reason: "waiting_user" });
  expect(steered).not.toHaveBeenCalled();
  expect(service.getTask(task.id)?.status).toBe("running");
});

it("rejects steer from another agent, a finished task, or an empty note", async () => {
  const { service, task } = runningTask();
  await expect(
    service.steer({
      taskId: task.id,
      userId: "patient",
      fromAgentId: "weather",
      note: "改要求",
    }),
  ).rejects.toThrow("只能插入自己派出的任务");
  await expect(
    service.steer({
      taskId: "missing",
      userId: "patient",
      fromAgentId: PERSONAL_ASSISTANT_ID,
      note: "改要求",
    }),
  ).rejects.toThrow("委托任务不存在");
  await expect(
    service.steer({
      taskId: task.id,
      userId: "patient",
      fromAgentId: PERSONAL_ASSISTANT_ID,
      note: "   ",
    }),
  ).rejects.toThrow("插入内容不能为空");
  await expect(
    service.steer({
      taskId: task.id,
      userId: "patient",
      fromAgentId: PERSONAL_ASSISTANT_ID,
      note: "x".repeat(STEER_NOTE_MAX + 1),
    }),
  ).rejects.toThrow("插入内容过长");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deleg-steer-done-"));
  const store = new DelegationStore(root);
  const done = store.create({
    userId: "patient",
    fromAgentId: PERSONAL_ASSISTANT_ID,
    toAgentId: "weather",
    toAgentName: "天气",
    brief: "查天气",
    wait: false,
  });
  store.update(done.id, { status: "completed" });
  const finished = serviceFor(root);
  const outcome = await finished.steer({
    taskId: done.id,
    userId: "patient",
    fromAgentId: PERSONAL_ASSISTANT_ID,
    note: "再查一次",
  });
  expect(outcome).toMatchObject({ queued: false, reason: "finished" });
});

it("exposes steer_delegation and reports a queued insert", async () => {
  const { service, task, steered } = runningTask();
  service.bindDelegationSteer(task.id, steered);
  const tools = new Map<string, { execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }> }>();
  createDelegateExtension(service, "patient", PERSONAL_ASSISTANT_ID)({
    on() {
      return undefined;
    },
    registerTool(tool: { name: string; execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }> }) {
      tools.set(tool.name, tool);
    },
  } as never);
  const tool = tools.get(STEER_DELEGATION_TOOL);
  expect(tool).toBeTruthy();
  const result = await tool!.execute("call-1", {
    task_id: task.id,
    note: "用简单方法修复和验证",
  });
  expect(result.content[0]?.text).toContain("Steering queued");
  expect(result.content[0]?.text).toContain(task.id);
  expect(result.content[0]?.text).toContain("Do not cancel");
  expect(steered).toHaveBeenCalledOnce();
});

it("steers the running specialist instead of opening a second task", async () => {
  const { service, task, steered, root } = runningTask();
  plantRecruited(root, "weather", "天气");
  service.bindDelegationSteer(task.id, steered);
  const result = await service.delegate({
    userId: "patient",
    fromAgentId: PERSONAL_ASSISTANT_ID,
    toAgentId: "weather",
    brief: "追加：必须使用深色背景",
    wait: false,
  });
  expect(result.task.id).toBe(task.id);
  expect(result.steered).toBe(true);
  expect(steered).toHaveBeenCalledOnce();
  expect(String(steered.mock.calls[0]?.[0])).toContain("深色背景");
  expect(service.listTasks("patient", { status: "running" })).toHaveLength(1);
});

it("revises the same task brief when that specialist cannot take a steer yet", async () => {
  const { service, task, root } = runningTask();
  plantRecruited(root, "weather", "天气");
  // 专员尚未 bind steer：再派一次只改同一张单的 brief，不开第二张。
  const result = await service.delegate({
    userId: "patient",
    fromAgentId: PERSONAL_ASSISTANT_ID,
    toAgentId: "weather",
    brief: "追加要求",
    wait: false,
  });
  expect(result.task.id).toBe(task.id);
  expect(result.task.brief).toBe("追加要求");
  expect(result.steered).toBe(true);
  const tasks = service.listTasks("patient");
  expect(tasks).toHaveLength(1);
  expect(tasks[0]?.id).toBe(task.id);
  expect(tasks[0]?.brief).toBe("追加要求");
});

function plantRecruited(root: string, agentId: string, name: string): void {
  const agentRoot = path.join(root, "users", "patient", "agents", agentId);
  fs.mkdirSync(path.join(agentRoot, "cwd", ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(agentRoot, "instance.json"),
    `${JSON.stringify({
      user_id: "patient",
      agent_id: agentId,
      name,
      role: "实现",
      background: "实现功能",
      package_version: 1,
      package_digest: "m",
      project_trust: "granted",
      tools: [],
      model_capabilities: [],
    })}\n`,
  );
}

function runningTask(pending: AskUserRequest[] = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deleg-steer-"));
  const store = new DelegationStore(root);
  const task = store.create({
    userId: "patient",
    fromAgentId: PERSONAL_ASSISTANT_ID,
    toAgentId: "weather",
    toAgentName: "天气",
    brief: "修复并验证",
    wait: false,
  });
  store.update(task.id, { status: "running" });
  const steered = vi.fn(async (_note: string) => undefined);
  return { root, service: serviceFor(root, pending), task, steered };
}

function serviceFor(root: string, pending: AskUserRequest[] = []) {
  return new DelegationService({
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
    approvals: new ApprovalBroker(),
    askUser: {
      request: vi.fn(),
      answer: vi.fn(),
      subscribe: vi.fn(),
      listPending: () => pending,
    } as never,
  });
}
