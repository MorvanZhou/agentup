import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { UIMessage, UIMessageChunk } from "ai";
import { expect, it, vi } from "vitest";

import type { ModelConfig } from "../src/config/load.js";
import { ProviderSecretPendingError } from "../src/config/provider.js";
import type { Visit } from "../src/package/sync.js";
import { ApprovalBroker } from "../src/session/hitl/approval/index.js";
import { DelegationService } from "../src/session/delegation/index.js";
import {
  createHolderTurnDriver,
  GroupRooms,
  GroupStore,
  GroupTurns,
  type GroupTurnDriver,
  type GroupTurnHandle,
} from "../src/session/group/index.js";
import type { PromptSession } from "../src/session/turn/types.js";
import { AskUserBroker } from "../src/session/tools/index.js";

const members = [
  { agentId: "pm", name: "产品经理" },
  { agentId: "dev", name: "开发" },
];

function roomsAt(root: string): GroupRooms {
  return new GroupRooms(
    root,
    new DelegationService({
      userDataRoot: root,
      backendUrl: "http://127.0.0.1:9",
      getModel: () => {
        throw new Error("no model");
      },
      approvals: new ApprovalBroker(),
      askUser: new AskUserBroker(),
    }),
  );
}

function scriptedDriver(): {
  driver: GroupTurnDriver;
  calls: Array<{ agentId: string; sessionDir: string; prompt: string }>;
  injected: string[];
  release: (text: string, message?: UIMessage) => void;
  fail: (error: Error) => void;
} {
  const calls: Array<{ agentId: string; sessionDir: string; prompt: string }> = [];
  const injected: string[] = [];
  let release: (text: string, message?: UIMessage) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const driver: GroupTurnDriver = {
    start(input) {
      calls.push({
        agentId: input.agentId,
        sessionDir: input.sessionDir,
        prompt: input.prompt,
      });
      input.onReady({
        inject: async (text) => {
          injected.push(text);
        },
        abort: async () => undefined,
      });
      input.onChunk([{ type: "start", messageId: "live" } as UIMessageChunk]);
      return new Promise((resolve, reject) => {
        const abort = () => reject(new Error("aborted"));
        if (input.signal.aborted) abort();
        else input.signal.addEventListener("abort", abort, { once: true });
        release = (text, message) => {
          input.signal.removeEventListener("abort", abort);
          resolve({ text, ...(message ? { message } : {}) });
        };
        fail = reject;
      });
    },
  };
  return {
    driver,
    calls,
    injected,
    release: (text, message) => release(text, message),
    fail: (error) => fail(error),
  };
}

it("does not start a holder when the message has no mention", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-turn-"));
  const script = scriptedDriver();
  const turns = new GroupTurns(roomsAt(root), script.driver, root);
  const room = turns.post("u1", createId(turns, root), "先看看");
  expect(script.calls).toEqual([]);
  expect(room.holderSpeaking).toBe(false);
  expect(room.holderId).toBeNull();
});

it("runs the holder turn in the group session and publishes progress before the reply is stored", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-turn-"));
  const script = scriptedDriver();
  const turns = new GroupTurns(roomsAt(root), script.driver, root);
  const room = turns.post("u1", turnsPostRoom(turns, root), "@产品经理 做一个简单迷宫");
  const chunks: UIMessageChunk[] = [];
  const sub = turns.subscribe("u1", room.id, (chunk) => chunks.push(chunk));

  expect(script.calls).toHaveLength(1);
  expect(script.calls[0]?.agentId).toBe("pm");
  expect(script.calls[0]?.sessionDir).toContain(
    `${path.sep}groups${path.sep}${room.id}${path.sep}holders${path.sep}pm${path.sep}sessions`,
  );
  expect(script.calls[0]?.prompt).toContain("@产品经理 做一个简单迷宫");
  expect(script.calls[0]?.sessionDir.includes(`${path.sep}agents${path.sep}`)).toBe(false);
  expect(fs.existsSync(path.join(root, "users", "u1", "agents"))).toBe(false);
  expect(chunks.length).toBeGreaterThan(0);
  expect(sub.closed).toBe(false);
  expect(room.holderSpeaking).toBe(true);

  script.release("迷宫好了");
  await vi.waitFor(() => {
    const settled = turns.get("u1", room.id);
    expect(settled.holderSpeaking).toBe(false);
    expect(settled.lines.some((line) => line.role === "agent" && line.text === "迷宫好了")).toBe(true);
  });
});

it("stores the driver assistant message parts on the settled agent line", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-turn-parts-"));
  const script = scriptedDriver();
  const turns = new GroupTurns(roomsAt(root), script.driver, root);
  const room = turns.post("u1", createId(turns, root), "@产品经理 做登录");
  const parts = [
    { type: "text" as const, text: "思考中" },
    {
      type: "dynamic-tool" as const,
      toolCallId: "t1",
      toolName: "read",
      state: "output-available" as const,
      input: {},
      output: "ok",
    },
    { type: "text" as const, text: "做好了" },
  ];
  script.release("做好了", {
    id: "asst-1",
    role: "assistant",
    parts,
    metadata: { custom: { agentUpSummary: { textPartIndex: 1 } } },
  });
  await vi.waitFor(() => {
    const settled = turns.get("u1", room.id);
    const agent = settled.lines.find((line) => line.role === "agent");
    expect(agent?.text).toBe("做好了");
    expect(agent?.parts).toEqual(parts);
    expect(agent?.assistantCustom).toEqual({ agentUpSummary: { textPartIndex: 1 } });
  });
});

it("folds a later message into the turn already running", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-turn-"));
  const script = scriptedDriver();
  const turns = new GroupTurns(roomsAt(root), script.driver, root);
  const room = turns.post("u1", createId(turns, root), "@产品经理 做登录");
  turns.post("u1", room.id, "再加一扇门");
  expect(script.calls).toHaveLength(1);
  expect(script.injected).toEqual(["再加一扇门"]);
  script.release("好");
  await vi.waitFor(() => expect(turns.get("u1", room.id).holderSpeaking).toBe(false));
});

it("rewrites the live user line and drops the old holder session", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-turn-"));
  const script = scriptedDriver();
  const turns = new GroupTurns(roomsAt(root), script.driver, root);
  const room = turns.post("u1", createId(turns, root), "@产品经理 做登录");
  const sessionDir = script.calls[0]?.sessionDir ?? "";
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "old.jsonl"), "{}\n");
  const messageId = room.lines.find((line) => line.role === "user")?.id ?? "";
  const edited = await turns.edit("u1", room.id, messageId, "@产品经理 做注册");
  expect(edited.lines.map((line) => line.text)).toEqual(["@产品经理 做注册"]);
  expect(edited.lines.some((line) => line.text === "已停止")).toBe(false);
  expect(script.calls).toHaveLength(2);
  expect(script.calls[1]?.prompt).toContain("做注册");
  expect(script.calls[1]?.prompt).not.toContain("做登录");
  expect(fs.existsSync(path.join(sessionDir, "old.jsonl"))).toBe(false);
});

it("deletes the group record, sessions, and workspace without reviving a speaking room", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-delete-"));
  const script = scriptedDriver();
  const turns = new GroupTurns(roomsAt(root), script.driver, root);
  const room = turns.post("u1", createId(turns, root), "@产品经理 做登录");
  const other = roomsAt(root).create({ userId: "u1", title: "另一个群", members });
  const work = path.join(root, "users", "u1", ".runtime", "groups", room.id, "workspace", "WORK", "note.txt");
  fs.mkdirSync(path.dirname(work), { recursive: true });
  fs.writeFileSync(work, "draft");

  await turns.remove("u1", room.id);

  const base = path.join(root, "users", "u1", ".runtime", "groups");
  expect(fs.existsSync(path.join(base, `${room.id}.json`))).toBe(false);
  expect(fs.existsSync(path.join(base, room.id))).toBe(false);
  expect(fs.existsSync(path.join(base, `${other.id}.json`))).toBe(true);
  expect(() => turns.get("u1", room.id)).toThrow("群不存在");
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(fs.existsSync(path.join(base, `${room.id}.json`))).toBe(false);
  expect(fs.existsSync(path.join(base, room.id))).toBe(false);
});

it("refuses to delete a missing group or a path outside the groups directory", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-delete-"));
  const turns = new GroupTurns(roomsAt(root), scriptedDriver().driver, root);
  const room = turns.post("u1", createId(turns, root), "@产品经理 做登录");
  const index = path.join(root, "users", "u1", ".runtime", "groups", `${room.id}.json`);

  await expect(turns.remove("u1", "missing")).rejects.toThrow("群不存在");
  await expect(turns.remove("u1", "..")).rejects.toThrow("群不存在");
  await expect(turns.remove("u1", "../u1")).rejects.toThrow("群不存在");
  expect(fs.existsSync(index)).toBe(true);
});

it("stops the live turn instead of leaving the room speaking", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-turn-"));
  const script = scriptedDriver();
  const turns = new GroupTurns(roomsAt(root), script.driver, root);
  const room = turns.post("u1", createId(turns, root), "@产品经理 做登录");
  const stopped = await turns.stop("u1", room.id);
  expect(stopped.holderSpeaking).toBe(false);
  expect(stopped.queue).toEqual([]);
  expect(stopped.lines.some((line) => line.role === "agent" && line.text === "已停止")).toBe(true);
  expect(script.calls).toHaveLength(1);
});

it("waits to resume the holder when the saved key is not in memory yet", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-turn-"));
  const script = scriptedDriver();
  let notifySecrets = (): void => undefined;
  const turns = new GroupTurns(roomsAt(root), script.driver, root, {
    whenSecretsReady(listener) {
      notifySecrets = listener;
      return () => undefined;
    },
  });
  const room = turns.post("u1", createId(turns, root), "@产品经理 做登录");
  script.fail(new ProviderSecretPendingError());
  // reject 的收尾在微任务里；等它写完再断言，避免还没停住就通知密钥。
  await new Promise((resolve) => setTimeout(resolve, 0));
  const store = new GroupStore(root);
  const parked = store.get("u1", room.id);
  expect(parked.holderSpeaking).toBe(true);
  expect(parked.lines.some((line) => line.role === "agent")).toBe(false);
  expect(script.calls).toHaveLength(1);
  notifySecrets();
  await vi.waitFor(() => expect(script.calls).toHaveLength(2));
  script.release("上一轮因退出中断");
  await vi.waitFor(() => {
    const saved = store.get("u1", room.id);
    expect(saved.holderSpeaking).toBe(false);
    expect(saved.lines.some((line) => line.role === "agent" && line.text === "上一轮因退出中断")).toBe(
      true,
    );
    expect(saved.lines.some((line) => line.text.includes("API Key"))).toBe(false);
  });
});

it("shows the model error as the holder's reply and does not keep speaking", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-turn-"));
  const script = scriptedDriver();
  const turns = new GroupTurns(roomsAt(root), script.driver, root);
  const room = turns.post("u1", createId(turns, root), "@产品经理 做登录");
  script.fail(new Error("模型不可用"));
  await vi.waitFor(() => {
    const settled = turns.get("u1", room.id);
    expect(settled.holderSpeaking).toBe(false);
    expect(settled.lines.some((line) => line.role === "agent" && line.text === "模型不可用")).toBe(true);
  });
  expect(script.calls).toHaveLength(1);
});

it("starts a holder that was left speaking with no session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-turn-"));
  const groups = roomsAt(root);
  const created = groups.create({ userId: "u1", title: "开发小队", members });
  groups.post("u1", created.id, "@产品经理 做一个简单迷宫");
  const script = scriptedDriver();
  const turns = new GroupTurns(groups, script.driver, root);
  turns.list("u1");
  turns.list("u1");
  expect(script.calls).toHaveLength(1);
  expect(script.calls[0]?.prompt).toContain("做一个简单迷宫");
  expect(script.calls[0]?.sessionDir.includes(`${path.sep}holders${path.sep}pm${path.sep}sessions`)).toBe(
    true,
  );
  expect(script.calls[0]?.sessionDir.includes(`${path.sep}agents${path.sep}`)).toBe(false);
});

it("opens the holder directory and streams the reply text", async () => {
  const holderDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-holder-session-"));
  const prompts: string[] = [];
  const cues: string[] = [];
  let release: () => void = () => undefined;
  let opened = "";
  const session: PromptSession = {
    subscribe(listener) {
      listener({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "迷宫好了" },
      } as AgentSessionEvent);
      return () => undefined;
    },
    prompt(text) {
      prompts.push(text);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    sendCustomMessage: async (message) => {
      cues.push(typeof message.content === "string" ? message.content : "");
    },
    abort: async () => undefined,
    dispose() {},
  };
  const driver = createHolderTurnDriver({
    resolveVisit: () =>
      ({
        userId: "u1",
        agentId: "pm",
        root: path.join(os.tmpdir(), "agentup-not-the-holder"),
        packageVersion: 1,
        packageDigest: "x",
        tools: [],
        modelCapabilities: [],
        projectTrust: "granted",
      }) as Visit,
    resolveModel: () => ({}) as ModelConfig,
    open: async (_visit, _model, sessionDir) => {
      opened = sessionDir;
      return session;
    },
  });
  let handle: GroupTurnHandle | undefined;
  const chunks: UIMessageChunk[] = [];
  const pending = driver.start({
    userId: "u1",
    groupId: "g1",
    agentId: "pm",
    prompt: "用户：做迷宫",
    sessionDir: holderDir,
    signal: new AbortController().signal,
    onChunk: (items) => chunks.push(...items),
    onReady: (next) => {
      handle = next;
    },
  });
  await vi.waitFor(() => expect(handle).toBeTruthy());
  await handle!.inject("再加一扇门");
  expect(cues).toEqual(["再加一扇门"]);
  expect(opened).toBe(holderDir);
  expect(prompts).toEqual(["用户：做迷宫"]);
  expect(chunks.some((chunk) => chunk.type === "text-delta")).toBe(true);
  release();
  await expect(pending).resolves.toMatchObject({ text: "迷宫好了" });
});

it("projects group HITL onto the holder stream and skips the one-to-one request", async () => {
  const holderDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-holder-hitl-"));
  let release: () => void = () => undefined;
  const session = {
    subscribe: () => () => undefined,
    prompt: () => new Promise<void>((resolve) => {
      release = resolve;
    }),
    abort: async () => undefined,
    dispose() {},
  };
  const driver = createHolderTurnDriver({
    resolveVisit: () =>
      ({
        userId: "u1",
        agentId: "pm",
        root: holderDir,
        packageVersion: 1,
        packageDigest: "x",
        tools: [],
        modelCapabilities: [],
        projectTrust: "granted",
      }) as Visit,
    resolveModel: () => ({}) as ModelConfig,
    open: async () => session as never,
    approvals: {
      subscribe(listener: (request: {
        id: string;
        userId: string;
        agentId: string;
        groupId?: string;
        toolCallId: string;
        toolName: string;
        args: Record<string, unknown>;
      }) => void) {
        listener({
          id: "group-approval",
          userId: "u1",
          agentId: "pm",
          groupId: "g1",
          toolCallId: "group-tool",
          toolName: "bash",
          args: { command: "ls" },
        });
        listener({
          id: "single-approval",
          userId: "u1",
          agentId: "pm",
          toolCallId: "single-tool",
          toolName: "bash",
          args: { command: "pwd" },
        });
        return () => undefined;
      },
    } as never,
  });
  const chunks: UIMessageChunk[] = [];
  const pending = driver.start({
    userId: "u1",
    groupId: "g1",
    agentId: "pm",
    prompt: "用户：做登录",
    sessionDir: holderDir,
    signal: new AbortController().signal,
    onChunk: (items) => chunks.push(...items),
    onReady: () => undefined,
  });
  await vi.waitFor(() => expect(chunks.some((chunk) => chunk.type === "data-agentup-approval")).toBe(true));
  const approvals = chunks.filter((chunk) => chunk.type === "data-agentup-approval");
  expect(approvals).toHaveLength(1);
  expect(JSON.stringify(approvals[0])).toContain("group-tool");
  expect(JSON.stringify(approvals[0])).not.toContain("single-tool");
  release();
  await pending;
});

it("keeps the holder after an async group delegation and resumes them when it is handed back", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-handback-"));
  seedRosterAgent(root, "dev", "开发", true);
  const script = scriptedDriver();
  const restore = hangDelegationRuns();
  try {
  const { delegation, turns } = turnsWithDelegation(root, script.driver);
  const room = turns.post("u1", createId(turns, root), "@产品经理 做登录");
  await delegation.delegate({
    userId: "u1",
    fromAgentId: "pm",
    toAgentId: "dev",
    brief: "做登录页",
    wait: false,
    groupId: room.id,
  });

  const running = turns.get("u1", room.id);
  expect(running.taskIds).toHaveLength(1);
  expect(running.holderId).toBe("pm");
  expect(running.holderSpeaking).toBe(true);

  script.release("已经派给开发");
  await vi.waitFor(() => {
    const settled = turns.get("u1", room.id);
    expect(settled.holderSpeaking).toBe(false);
    expect(settled.phase).toBe("task");
    expect(settled.holderId).toBe("pm");
    expect(settled.taskIds).toEqual(running.taskIds);
  });

  const sessionDir = script.calls[0]?.sessionDir ?? "";
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "turn.jsonl"), "{}\n");
  delegation.cancel(running.taskIds[0]!, "u1");
  await vi.waitFor(() => expect(script.calls).toHaveLength(2));
  expect(script.calls[1]?.agentId).toBe("pm");
  expect(script.calls[1]?.prompt).toContain("用户已取消");
  expect(script.calls[1]?.prompt).not.toBe("@产品经理 做登录");
  expect(turns.get("u1", room.id).lines.some((line) => line.role === "delegation" && line.summary === "用户已取消")).toBe(
    true,
  );
  script.release("收到交回");
  await vi.waitFor(() => expect(turns.get("u1", room.id).holderSpeaking).toBe(false));
  } finally {
    restore();
  }
});

it("does not pin the holder when the specialist visit cannot be opened", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-no-visit-"));
  seedRosterAgent(root, "dev", "开发", false);
  const script = scriptedDriver();
  const { delegation, turns } = turnsWithDelegation(root, script.driver);
  const room = turns.post("u1", createId(turns, root), "@产品经理 做登录");
  await expect(
    delegation.delegate({
      userId: "u1",
      fromAgentId: "pm",
      toAgentId: "dev",
      brief: "做登录页",
      wait: false,
      groupId: room.id,
    }),
  ).rejects.toThrow(/尚未同步/);
  expect(turns.get("u1", room.id).taskIds).toEqual([]);
  script.release("派不出去");
  await vi.waitFor(() => {
    const settled = turns.get("u1", room.id);
    expect(settled.phase).toBe("idle");
    expect(settled.holderId).toBe("pm");
  });
});

it("merges a handback into the holder turn that is still speaking", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-merge-"));
  seedRosterAgent(root, "dev", "开发", true);
  const script = scriptedDriver();
  const restore = hangDelegationRuns();
  try {
  const { delegation, turns } = turnsWithDelegation(root, script.driver);
  const room = turns.post("u1", createId(turns, root), "@产品经理 做登录");
  await delegation.delegate({
    userId: "u1",
    fromAgentId: "pm",
    toAgentId: "dev",
    brief: "做登录页",
    wait: false,
    groupId: room.id,
  });
  const taskId = turns.get("u1", room.id).taskIds[0];
  expect(taskId).toBeTruthy();
  delegation.cancel(taskId!, "u1");
  expect(script.calls).toHaveLength(1);
  expect(script.injected).toContain("用户已取消");
  script.release("收到，这轮收口");
  await vi.waitFor(() => {
    const settled = turns.get("u1", room.id);
    expect(settled.holderSpeaking).toBe(false);
    expect(settled.phase).toBe("idle");
    expect(settled.lines.some((line) => line.role === "delegation" && line.summary === "用户已取消")).toBe(
      true,
    );
  });
  expect(script.calls).toHaveLength(1);
  } finally {
    restore();
  }
});

it("does not open a one-to-one session when the member cannot be visited", async () => {
  const driver = createHolderTurnDriver({
    resolveVisit: () => null,
    resolveModel: () => ({}) as ModelConfig,
    open: async () => {
      throw new Error("should not open");
    },
  });
  await expect(
    driver.start({
      userId: "u1",
      groupId: "g1",
      agentId: "pm",
      prompt: "用户：做迷宫",
      sessionDir: fs.mkdtempSync(path.join(os.tmpdir(), "agentup-holder-missing-")),
      signal: new AbortController().signal,
      onChunk: () => undefined,
      onReady: () => undefined,
    }),
  ).rejects.toThrow("无法打开这位成员的会话");
});

function turnsWithDelegation(root: string, driver: GroupTurnDriver): {
  delegation: DelegationService;
  turns: GroupTurns;
} {
  const delegation = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => ({}) as ModelConfig,
    approvals: new ApprovalBroker(),
    askUser: new AskUserBroker(),
  });
  return { delegation, turns: new GroupTurns(new GroupRooms(root, delegation), driver, root) };
}

/** 挡住真正开子会话。登记发生在这之前，测试可以停在「单还在跑」。 */
function hangDelegationRuns(): () => void {
  const spy = vi
    .spyOn(DelegationService.prototype as unknown as { executeTask: () => Promise<void> }, "executeTask")
    .mockImplementation(() => new Promise(() => undefined));
  return () => spy.mockRestore();
}

/** visitReady 时补上 cwd/.pi，委托才能装好子会话；否则停在「尚未同步」。 */
function seedRosterAgent(root: string, agentId: string, name: string, visitReady: boolean): void {
  const agentRoot = path.join(root, "users", "u1", "agents", agentId);
  fs.mkdirSync(agentRoot, { recursive: true });
  if (visitReady) fs.mkdirSync(path.join(agentRoot, "cwd", ".pi"), { recursive: true });
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

function turnsPostRoom(turns: GroupTurns, root: string): string {
  return createId(turns, root);
}

function createId(turns: GroupTurns, root: string): string {
  const groups = roomsAt(root);
  // 建群不开工。真正的 @ 走 turns.post，避免和 ensure 各开一轮。
  void turns;
  return groups.create({ userId: "u1", title: "开发小队", members }).id;
}
