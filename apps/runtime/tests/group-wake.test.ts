import { expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ApprovalBroker } from "../src/session/hitl/approval/index.js";
import { notifyParent } from "../src/session/delegation/service/notify.js";
import { DelegationService } from "../src/session/delegation/service/index.js";
import { GroupRooms } from "../src/session/group/index.js";
import { DelegationStore } from "../src/session/delegation/store.js";

it("delivers a group task back to the group and skips the one-to-one wake", () => {
  const store = new DelegationStore();
  const created = store.create({
    userId: "u1",
    fromAgentId: "pm",
    toAgentId: "dev",
    toAgentName: "开发",
    brief: "做登录",
    wait: false,
    groupId: "g1",
  });
  store.update(created.id, { status: "completed", resultSummary: "登录页已完成" });
  const wake = vi.fn();
  const group = vi.fn();
  notifyParent(store, wake, store.get(created.id)!, group);
  expect(wake).not.toHaveBeenCalled();
  expect(group).toHaveBeenCalledOnce();
  expect(group.mock.calls[0]?.[0]).toMatchObject({ groupId: "g1", id: created.id });
  expect(store.get(created.id)?.notified).toBe(true);
  // 群终态同时标 seen，勿进桌面一对一 unseen → 私聊未读。
  expect(store.get(created.id)?.seen).toBe(true);
});

it("heals old group terminals that were notified but never seen", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-seen-heal-"));
  const disk = new DelegationStore(root);
  const created = disk.create({
    userId: "u1",
    fromAgentId: "pm",
    toAgentId: "dev",
    toAgentName: "开发",
    brief: "做登录",
    wait: false,
    groupId: "g1",
  });
  disk.update(created.id, {
    status: "cancelled",
    notified: true,
    seen: false,
    resultSummary: "已取消",
  });
  const service = serviceAt(root);
  expect(service.listTasks("u1", { unseenOnly: true })).toEqual([]);
  expect(service.getTask(created.id)?.seen).toBe(true);
});

it("does not park a second group specialist behind the open task", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-queue-"));
  const store = new DelegationStore(root);
  store.create({
    userId: "u1",
    fromAgentId: "pm",
    toAgentId: "dev",
    toAgentName: "开发",
    brief: "做登录",
    wait: false,
    groupId: "g1",
  });
  const running = store.list("u1")[0];
  if (!running) throw new Error("missing task");
  store.update(running.id, { status: "running" });
  const service = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => {
      throw new Error("不应开跑");
    },
    approvals: new ApprovalBroker(),
    askUser: { request: vi.fn(), answer: vi.fn(), subscribe: vi.fn() } as never,
  });
  const queued = vi.fn();
  service.setGroupQueue(queued);
  service.setGroupMembers(() => [
    { agentId: "pm", name: "产品" },
    { agentId: "dev", name: "开发" },
    { agentId: "design", name: "设计师" },
  ]);
  await expect(
    service.delegateFanout({
      userId: "u1",
      fromAgentId: "pm",
      groupId: "g1",
      items: [{ toAgentId: "design", brief: "出视觉" }],
      wait: false,
    }),
  ).rejects.toThrow(/可用/);
  expect(queued).not.toHaveBeenCalled();
  expect(store.list("u1")).toHaveLength(1);
});

it("does not register a one-to-one delegation as a group task", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-plain-"));
  const agentRoot = path.join(root, "users", "u1", "agents", "dev");
  fs.mkdirSync(agentRoot, { recursive: true });
  fs.writeFileSync(
    path.join(agentRoot, "instance.json"),
    `${JSON.stringify({
      user_id: "u1",
      agent_id: "dev",
      name: "开发",
      role: "开发",
      background: "开发",
      package_version: 1,
      package_digest: "x",
      project_trust: "granted",
      tools: [],
      model_capabilities: [],
    })}\n`,
  );
  const service = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => {
      throw new Error("不应开跑");
    },
    approvals: new ApprovalBroker(),
    askUser: { request: vi.fn(), answer: vi.fn(), subscribe: vi.fn() } as never,
  });
  const started = vi.fn();
  service.setGroupTaskStarted(started);
  await expect(
    service.delegate({
      userId: "u1",
      fromAgentId: "pm",
      toAgentId: "dev",
      brief: "做登录",
      wait: false,
    }),
  ).rejects.toThrow(/尚未同步/);
  expect(started).not.toHaveBeenCalled();
});

it("does not attach a one-to-one delegation to an open group task", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-explicit-"));
  const store = new DelegationStore(root);
  store.create({
    userId: "u1",
    fromAgentId: "pm",
    toAgentId: "dev",
    toAgentName: "开发",
    brief: "做登录",
    wait: false,
    groupId: "g1",
  });
  const running = store.list("u1")[0];
  if (!running) throw new Error("missing task");
  store.update(running.id, { status: "running" });
  const service = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => {
      throw new Error("不应开跑");
    },
    approvals: new ApprovalBroker(),
    askUser: { request: vi.fn(), answer: vi.fn(), subscribe: vi.fn() } as never,
  });
  const queued = vi.fn();
  service.setGroupQueue(queued);
  await expect(
    service.delegateFanout({
      userId: "u1",
      fromAgentId: "pm",
      items: [{ toAgentId: "design", brief: "出视觉" }],
      wait: false,
    }),
  ).rejects.toThrow(/可用/);
  expect(queued).not.toHaveBeenCalled();
});

it("rejects a group delegation to someone outside the room", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-outsider-"));
  const service = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => {
      throw new Error("不应开跑");
    },
    approvals: new ApprovalBroker(),
    askUser: { request: vi.fn(), answer: vi.fn(), subscribe: vi.fn() } as never,
  });
  const groups = new GroupRooms(root, service);
  const room = groups.create({
    userId: "u1",
    title: "组",
    members: [
      { agentId: "pm", name: "产品" },
      { agentId: "dev", name: "开发" },
    ],
  });
  await expect(
    service.delegateFanout({
      userId: "u1",
      fromAgentId: "pm",
      groupId: room.id,
      items: [{ toAgentId: "outsider", brief: "做事" }],
      wait: false,
    }),
  ).rejects.toThrow(/不是群成员/);
  expect(new DelegationStore(root).list("u1")).toEqual([]);
});

it("rejects a group delegation when the room is gone", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-missing-"));
  const service = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => {
      throw new Error("不应开跑");
    },
    approvals: new ApprovalBroker(),
    askUser: { request: vi.fn(), answer: vi.fn(), subscribe: vi.fn() } as never,
  });
  new GroupRooms(root, service);
  await expect(
    service.delegateFanout({
      userId: "u1",
      fromAgentId: "pm",
      groupId: "missing-room",
      items: [{ toAgentId: "dev", brief: "做事" }],
      wait: false,
    }),
  ).rejects.toThrow(/群不存在/);
});

/** 补上 cwd/.pi，委托才能装好子会话。 */
function seedVisitAgent(root: string, agentId: string, name: string): void {
  const agentRoot = path.join(root, "users", "u1", "agents", agentId);
  fs.mkdirSync(path.join(agentRoot, "cwd", ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(agentRoot, "instance.json"),
    `${JSON.stringify({
      user_id: "u1",
      agent_id: agentId,
      name,
      role: name,
      background: name,
      package_version: 1,
      package_digest: "x",
      project_trust: "granted",
      tools: [],
      model_capabilities: [],
    })}\n`,
  );
}

/** 挂住真正开子会话，让测试停在「单还在跑」，不真正起模型。 */
function hangRuns(): () => void {
  const spy = vi
    .spyOn(DelegationService.prototype as unknown as { executeTask: () => Promise<void> }, "executeTask")
    .mockImplementation(() => new Promise(() => undefined));
  return () => spy.mockRestore();
}

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function serviceAt(root: string): DelegationService {
  return new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => {
      throw new Error("不应开跑");
    },
    approvals: new ApprovalBroker(),
    askUser: { request: vi.fn(), answer: vi.fn(), subscribe: vi.fn() } as never,
  });
}

it("forces a group delegation to be async when wait is omitted", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-async-omit-"));
  seedVisitAgent(root, "dev", "开发");
  const service = serviceAt(root);
  const started = vi.fn();
  service.setGroupTaskStarted(started);
  service.setGroupMembers(() => [
    { agentId: "pm", name: "产品" },
    { agentId: "dev", name: "开发" },
  ]);
  const restore = hangRuns();
  try {
    const pending = service.delegateFanout({
      userId: "u1",
      fromAgentId: "pm",
      groupId: "g1",
      items: [{ toAgentId: "dev", brief: "做登录" }],
      // wait 省略：群内也不允许回落同步
    });
    const winner = await Promise.race([pending.then(() => "done"), later(150).then(() => "pending")]);
    expect(winner).toBe("done");
    const task = service.listTasks("u1", { status: "running" })[0];
    expect(task).toMatchObject({ wait: false, groupId: "g1" });
    expect(started).toHaveBeenCalledWith({ userId: "u1", groupId: "g1", taskId: task.id });
  } finally {
    restore();
  }
});

it("forces a group delegation to be async even when wait=true is passed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-async-explicit-"));
  seedVisitAgent(root, "dev", "开发");
  const service = serviceAt(root);
  service.setGroupMembers(() => [
    { agentId: "pm", name: "产品" },
    { agentId: "dev", name: "开发" },
  ]);
  const restore = hangRuns();
  try {
    const pending = service.delegateFanout({
      userId: "u1",
      fromAgentId: "pm",
      groupId: "g1",
      items: [{ toAgentId: "dev", brief: "做登录" }],
      wait: true,
    });
    const winner = await Promise.race([pending.then(() => "done"), later(150).then(() => "pending")]);
    expect(winner).toBe("done");
    expect(service.listTasks("u1", { status: "running" })[0]).toMatchObject({ wait: false, groupId: "g1" });
  } finally {
    restore();
  }
});

it("keeps the one-to-one sync fallback when wait is omitted outside groups", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deleg-sync-default-"));
  seedVisitAgent(root, "dev", "开发");
  const service = serviceAt(root);
  const restore = hangRuns();
  try {
    const pending = service.delegateFanout({
      userId: "u1",
      fromAgentId: "pm",
      items: [{ toAgentId: "dev", brief: "做登录" }],
      // 无 groupId：单项省略 wait 仍回落同步（一对一旧行为）
    });
    const task = await vi.waitFor(() => {
      const running = service.listTasks("u1", { status: "running" })[0];
      expect(running).toBeDefined();
      return running!;
    });
    expect(task.wait).toBe(true);
    const winner = await Promise.race([pending.then(() => "done"), later(120).then(() => "pending")]);
    expect(winner).toBe("pending");
  } finally {
    restore();
  }
});
