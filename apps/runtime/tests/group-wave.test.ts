import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { GroupStore, holderSessionRelative, projectTranscript } from "../src/session/group/index.js";
import {
  createGroupRoom,
  finishHolderTurn,
  postUserMessage,
  replaceUserMessage,
} from "../src/session/group/wave.js";

const members = [
  { agentId: "pm", name: "产品经理" },
  { agentId: "dev", name: "开发" },
  { agentId: "design", name: "设计师" },
];

it("drops a group file that is not the current record version", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-old-"));
  const dir = path.join(root, "users", "u1", ".runtime", "groups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "old.json");
  fs.writeFileSync(file, JSON.stringify({ id: "old", userId: "u1", title: "旧", lines: [] }));
  const store = new GroupStore(root);
  expect(store.list("u1")).toEqual([]);
  expect(fs.existsSync(file)).toBe(false);
  expect(() => store.get("u1", "old")).toThrow(/群不存在/);
});

it("accepts up to 6 members and rejects a larger room", () => {
  const six = Array.from({ length: 6 }, (_, index) => ({
    agentId: `a${index}`,
    name: `成员${index}`,
  }));
  expect(createGroupRoom({ id: "g1", userId: "u1", title: "组", members: six }).members).toHaveLength(6);
  expect(() =>
    createGroupRoom({
      id: "g2",
      userId: "u1",
      title: "组",
      members: [...six, { agentId: "a6", name: "多出来" }],
    }),
  ).toThrow(/2 到 6 人/);
});

it("assigns a short group id like user and agent ids", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-id-"));
  const store = new GroupStore(root);
  const first = store.create({ userId: "u1", title: "组", members });
  const second = store.create({ userId: "u1", title: "另一组", members });
  expect(first.id).toMatch(/^[A-Za-z0-9]{8}$/);
  expect(second.id).toMatch(/^[A-Za-z0-9]{8}$/);
  expect(first.id).not.toBe(second.id);
});

it("renames a group title and falls back to member names when blank", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-rename-"));
  const store = new GroupStore(root);
  const room = store.create({ userId: "u1", title: "产品组", members });
  store.post("u1", room.id, "@产品经理 做登录");
  const renamed = store.rename("u1", room.id, "  新名字  ");
  expect(renamed.title).toBe("新名字");
  expect(store.peek("u1", room.id).title).toBe("新名字");
  // 改名不丢会话行
  expect(store.get("u1", room.id).lines.length).toBeGreaterThan(0);
  const cleared = store.rename("u1", room.id, "   ");
  expect(cleared.title).toBe("产品经理、开发、设计师");
});

it("keeps the group transcript out of one-to-one session directories", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-"));
  const store = new GroupStore(root);
  const room = store.create({ userId: "u1", title: "产品组", members });
  const posted = store.post("u1", room.id, "@产品经理 做登录");
  const oneToOne = path.join(root, "users", "u1", "agents", "pm", "sessions");
  const sessions = path.join(root, "users", "u1", ".runtime", "groups", room.id, "sessions");
  const holder = path.join(root, "users", "u1", holderSessionRelative(room.id, "pm"));
  expect(fs.existsSync(oneToOne)).toBe(false);
  expect(fs.readdirSync(sessions).length).toBeGreaterThan(0);
  expect(fs.existsSync(holder)).toBe(false);
  expect(posted.room.holderId).toBe("pm");
  expect(posted.effect.type).toBe("start_holder");
});

it("does not run anyone when the user speaks without a mention", () => {
  const store = new GroupStore(fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-")));
  const room = store.create({ userId: "u1", title: "组", members });
  const posted = store.post("u1", room.id, "先看看");
  expect(posted.effect).toEqual({ type: "stored" });
  expect(posted.room.holderId).toBeNull();
  expect(posted.room.phase).toBe("idle");
});

it("gives a sub agent only the assignment text, not the room transcript", () => {
  const store = new GroupStore(fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-")));
  const room = store.create({ userId: "u1", title: "组", members });
  store.post("u1", room.id, "@产品经理 做登录，不要用数据库");
  const brief = store.subBrief("@开发 按上面的要求做登录页");
  expect(brief).toBe("@开发 按上面的要求做登录页");
  expect(brief).not.toContain("不要用数据库");
});

it("places a sub-agent line after the holder reply, and keeps it behind the live bubble until then", () => {
  const store = new GroupStore(fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-place-")));
  const room = store.create({ userId: "u1", title: "组", members });
  store.post("u1", room.id, "@产品经理 做登录");
  const opened = store.startTask("u1", room.id, "task-dev", {
    keepSpeaking: true,
    authorId: "dev",
    authorName: "开发",
    brief: "做登录页",
  });
  expect(opened.holderSpeaking).toBe(true);
  expect(opened.lines.some((line) => line.role === "delegation")).toBe(false);
  expect(opened.pendingDelegations.map((item) => item.authorId)).toEqual(["dev"]);
  const closed = store.finishHolder("u1", room.id, "已经派给开发");
  const roles = closed.room.lines.map((line) => line.role);
  expect(roles.indexOf("agent")).toBeLessThan(roles.lastIndexOf("delegation"));
  const card = closed.room.lines.find((line) => line.role === "delegation");
  expect(card).toMatchObject({
    authorId: "dev",
    authorName: "开发",
    brief: "做登录页",
    taskId: "task-dev",
    activity: "queued",
    handoff: "pending",
    parentLineId: closed.room.lines.find((line) => line.role === "agent")?.id,
  });
  expect(projectTranscript(closed.room)).not.toContain("做登录页");
  const done = store.finishTask("u1", room.id, "task-dev", "登录页已完成");
  expect(projectTranscript(done.room)).toContain("开发：登录页已完成");
  expect(projectTranscript(done.room)).not.toContain("tool:");
  const cardAfter = done.room.lines.find((line) => line.role === "delegation");
  expect(cardAfter?.handoff).toBe("pending");
  expect(cardAfter?.summary).toBe("登录页已完成");
});

it("keeps the holder speaking when a task is attached mid-turn, then waits for handback", () => {
  const store = new GroupStore(fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-open-")));
  const room = store.create({ userId: "u1", title: "组", members });
  store.post("u1", room.id, "@产品经理 做登录");
  const opened = store.startTask("u1", room.id, "task-dev", { keepSpeaking: true });
  expect(opened.holderSpeaking).toBe(true);
  expect(opened.phase).toBe("task");
  expect(opened.taskIds).toEqual(["task-dev"]);
  const closed = store.finishHolder("u1", room.id, "已经派给开发");
  expect(closed.room.holderId).toBe("pm");
  expect(closed.room.holderSpeaking).toBe(false);
  expect(closed.room.phase).toBe("task");
  expect(closed.effect.type).toBe("stored");
});

it("keeps the holder when the user mentions someone else during a running task", () => {
  const store = new GroupStore(fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-")));
  const room = store.create({ userId: "u1", title: "组", members });
  store.post("u1", room.id, "@产品经理 做登录");
  store.startTask("u1", room.id, "task-dev");
  const posted = store.post("u1", room.id, "@设计师 做一页幻灯");
  expect(posted.room.holderId).toBe("pm");
  expect(posted.room.taskIds).toEqual(["task-dev"]);
  expect(posted.room.queue).toEqual([]);
  expect(posted.effect.type).toBe("resume_holder");
  if (posted.effect.type === "resume_holder") expect(posted.effect.agentId).toBe("pm");
});

it("merges a finished task into the holder turn that is already speaking", () => {
  const store = new GroupStore(fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-")));
  const room = store.create({ userId: "u1", title: "组", members });
  store.post("u1", room.id, "@产品经理 做登录");
  store.startTask("u1", room.id, "task-dev");
  store.post("u1", room.id, "@设计师 做幻灯");
  const finished = store.finishTask("u1", room.id, "task-dev", "登录页已完成");
  expect(finished.effect.type).toBe("merge_holder");
  expect(finished.room.holderId).toBe("pm");
  expect(finished.room.queue).toEqual([]);
  const delegation = finished.room.lines.find((line) => line.role === "delegation");
  expect(delegation?.summary).toBe("登录页已完成");
  expect(delegation?.handoff).toBe("pending");
  expect(finished.room.lines.some((line) => line.role === "handback")).toBe(false);
});

it("keeps the same holder when the round ends instead of handing the floor to someone else", () => {
  const store = new GroupStore(fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-")));
  const room = store.create({ userId: "u1", title: "组", members });
  store.post("u1", room.id, "@产品经理 做登录");
  store.startTask("u1", room.id, "task-dev");
  store.post("u1", room.id, "@设计师 做幻灯");
  store.finishTask("u1", room.id, "task-dev", "登录页已完成");
  const closed = store.finishHolder("u1", room.id, "登录做好了，接下来等设计师");
  expect(closed.room.holderId).toBe("pm");
  expect(closed.room.holderSpeaking).toBe(false);
  expect(closed.room.phase).toBe("idle");
  expect(closed.room.queue).toEqual([]);
  expect(closed.effect.type).toBe("stored");
  expect(projectTranscript(closed.room)).toContain("登录做好了");
  expect(projectTranscript(closed.room)).not.toContain("tool:");
});

it("resumes the previous holder when the next message does not mention anyone", () => {
  const store = new GroupStore(fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-resume-")));
  const room = store.create({ userId: "u1", title: "组", members });
  store.post("u1", room.id, "@产品经理 做登录");
  store.finishHolder("u1", room.id, "登录做好了");
  const posted = store.post("u1", room.id, "再改一下颜色");
  expect(posted.room.holderId).toBe("pm");
  expect(posted.effect.type).toBe("resume_holder");
  if (posted.effect.type === "resume_holder") expect(posted.effect.agentId).toBe("pm");
});

it("switches the holder when a new member is mentioned after the round ends", () => {
  const store = new GroupStore(fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-switch-")));
  const room = store.create({ userId: "u1", title: "组", members });
  store.post("u1", room.id, "@产品经理 做登录");
  store.finishHolder("u1", room.id, "登录做好了");
  const posted = store.post("u1", room.id, "@设计师 出一页");
  expect(posted.room.holderId).toBe("design");
  expect(posted.room.queue).toEqual([]);
  expect(posted.effect.type).toBe("start_holder");
  if (posted.effect.type === "start_holder") expect(posted.effect.agentId).toBe("design");
  expect(posted.room.lines.some((line) => line.role === "system" && line.mentionIds.includes("design"))).toBe(
    true,
  );
});

it("records a second task beside the one already running", () => {
  const store = new GroupStore(fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-parallel-")));
  const room = store.create({ userId: "u1", title: "组", members });
  store.post("u1", room.id, "@产品经理 做登录");
  store.startTask("u1", room.id, "task-dev", { authorId: "dev", authorName: "开发", brief: "登录页" });
  const next = store.startTask("u1", room.id, "task-design", {
    authorId: "design",
    authorName: "设计师",
    brief: "幻灯",
  });
  expect(next.holderId).toBe("pm");
  expect(next.taskIds).toEqual(["task-dev", "task-design"]);
});

it("hands a group-owned background result back to the current holder", () => {
  const store = new GroupStore(fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-bg-")));
  const room = store.create({ userId: "u1", title: "组", members });
  store.post("u1", room.id, "@产品经理 做登录");
  store.noteReply("u1", room.id, "先看需求");
  const noted = store.noteExternal("u1", room.id, "【后台任务完成】build");
  expect(noted.room.holderId).toBe("pm");
  expect(noted.room.holderSpeaking).toBe(true);
  expect(noted.room.lines.at(-1)?.text).toContain("后台任务完成");
  expect(noted.effect.type).toBe("resume_holder");
});

it("replaces a user line and drops the transcript after it", () => {
  let current = createGroupRoom({ id: "g1", userId: "u1", title: "组", members });
  current = postUserMessage(current, { id: "u1", text: "@产品经理 做登录", now: 1 }).room;
  current = finishHolderTurn(current, { id: "a1", text: "登录做好了", now: 2 }).room;
  current = postUserMessage(current, { id: "u2", text: "再改一下颜色", now: 3 }).room;
  const edited = replaceUserMessage(current, {
    messageId: "u1",
    id: "u3",
    text: "@设计师 做海报",
    now: 4,
  });
  expect(edited.room.lines.map((line) => line.text)).toEqual(["@设计师 做海报"]);
  expect(edited.room.holderId).toBe("design");
  expect(edited.effect.type).toBe("start_holder");
  if (edited.effect.type === "start_holder") expect(edited.effect.prompt).not.toContain("做登录");
});

it("keeps earlier lines when a later user line is edited", () => {
  let current = createGroupRoom({ id: "g1", userId: "u1", title: "组", members });
  current = postUserMessage(current, { id: "u1", text: "@产品经理 做登录", now: 1 }).room;
  current = finishHolderTurn(current, { id: "a1", text: "登录做好了", now: 2 }).room;
  current = postUserMessage(current, { id: "u2", text: "再改颜色", now: 3 }).room;
  const edited = replaceUserMessage(current, {
    messageId: "u2",
    id: "u3",
    text: "@产品经理 改成蓝色",
    now: 4,
  });
  expect(edited.room.lines.map((line) => line.id)).toEqual(["u1", "a1", "u3"]);
  expect(edited.room.holderId).toBe("pm");
  expect(edited.effect.type).toBe("resume_holder");
  if (edited.effect.type !== "resume_holder") return;
  expect(edited.effect.prompt).toContain("登录做好了");
  expect(edited.effect.prompt).toContain("改成蓝色");
  expect(edited.effect.prompt).not.toContain("再改颜色");
});

it("stores the replacement without a holder when the new text mentions nobody", () => {
  let current = createGroupRoom({ id: "g1", userId: "u1", title: "组", members });
  current = postUserMessage(current, { id: "u1", text: "@产品经理 做登录", now: 1 }).room;
  const edited = replaceUserMessage(current, {
    messageId: "u1",
    id: "u2",
    text: "先看看",
    now: 2,
  });
  expect(edited.effect.type).toBe("stored");
  expect(edited.room.holderId).toBeNull();
  expect(edited.room.lines.map((line) => line.text)).toEqual(["先看看"]);
});

it("keeps a task started before the edited line and drops that line's queue card", () => {
  let current = createGroupRoom({ id: "g1", userId: "u1", title: "组", members });
  current = postUserMessage(current, { id: "u1", text: "@产品经理 做登录", now: 1 }).room;
  current = finishHolderTurn(current, {
    id: "a1",
    text: "派给开发",
    now: 2,
    startedTaskId: "task-dev",
  }).room;
  current = postUserMessage(current, { id: "u2", text: "@设计师 做幻灯", now: 3 }).room;
  const edited = replaceUserMessage(current, {
    messageId: "u2",
    id: "u3",
    text: "改成蓝色",
    now: 4,
  });
  expect(edited.cancelledTaskIds).toEqual([]);
  expect(edited.room.taskIds).toEqual(["task-dev"]);
  expect(edited.room.queue).toEqual([]);
  expect(edited.room.holderId).toBe("pm");
  expect(edited.room.lines.some((line) => line.id === "u2")).toBe(false);
  expect(edited.effect.type).toBe("resume_holder");
});

it("cancels a task that was started by the discarded turn", () => {
  let current = createGroupRoom({ id: "g1", userId: "u1", title: "组", members });
  current = postUserMessage(current, { id: "u1", text: "@产品经理 做登录", now: 1 }).room;
  current = finishHolderTurn(current, {
    id: "a1",
    text: "派给开发",
    now: 2,
    startedTaskId: "task-dev",
  }).room;
  const edited = replaceUserMessage(current, {
    messageId: "u1",
    id: "u2",
    text: "@产品经理 做注册",
    now: 3,
  });
  expect(edited.cancelledTaskIds).toEqual(["task-dev"]);
  expect(edited.room.taskIds).toEqual([]);
  expect(edited.room.lines.map((line) => line.text)).toEqual(["@产品经理 做注册"]);
  expect(edited.room.holderId).toBe("pm");
});

it("rejects editing a line that is missing or not a user message", () => {
  let current = createGroupRoom({ id: "g1", userId: "u1", title: "组", members });
  current = postUserMessage(current, { id: "u1", text: "@产品经理 做登录", now: 1 }).room;
  current = finishHolderTurn(current, { id: "a1", text: "登录做好了", now: 2 }).room;
  expect(() =>
    replaceUserMessage(current, { messageId: "missing", id: "u2", text: "x", now: 3 }),
  ).toThrow("消息不存在");
  expect(() => replaceUserMessage(current, { messageId: "a1", id: "u2", text: "x", now: 3 })).toThrow(
    "消息不存在",
  );
});

it("drops the queue when the wave is stopped", () => {
  const store = new GroupStore(fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-")));
  const room = store.create({ userId: "u1", title: "组", members });
  store.post("u1", room.id, "@产品经理 做登录");
  store.startTask("u1", room.id, "task-dev");
  store.post("u1", room.id, "@设计师 做幻灯");
  const stopped = store.stop("u1", room.id);
  expect(stopped.queue).toEqual([]);
  expect(stopped.taskIds).toEqual(["task-dev"]);
});

it("stores assistant parts on the agent line without leaking them into the transcript", () => {
  let current = createGroupRoom({ id: "g1", userId: "u1", title: "组", members });
  current = postUserMessage(current, { id: "u1", text: "@产品经理 做登录", now: 1 }).room;
  const parts = [
    { type: "text" as const, text: "先读文件" },
    {
      type: "dynamic-tool" as const,
      toolCallId: "t1",
      toolName: "read",
      state: "output-available" as const,
      input: {},
      output: "secret-tool-body",
    },
    { type: "text" as const, text: "登录做好了" },
  ];
  current = finishHolderTurn(current, {
    id: "a1",
    text: "登录做好了",
    now: 2,
    parts,
    assistantCustom: { agentUpSummary: { textPartIndex: 1 } },
  }).room;
  const agent = current.lines.find((line) => line.id === "a1");
  expect(agent?.parts).toEqual(parts);
  expect(agent?.assistantCustom).toEqual({ agentUpSummary: { textPartIndex: 1 } });
  expect(projectTranscript(current)).toContain("登录做好了");
  expect(projectTranscript(current)).not.toContain("secret-tool-body");
  expect(projectTranscript(current)).not.toContain("先读文件");
});

it("persists assistant parts through GroupStore.finishHolder", () => {
  const store = new GroupStore(fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-parts-")));
  const room = store.create({ userId: "u1", title: "组", members });
  store.post("u1", room.id, "@产品经理 做登录");
  const parts = [{ type: "text" as const, text: "好的" }];
  const closed = store.finishHolder("u1", room.id, "好的", {
    parts,
    assistantCustom: { agentUpArtifacts: { files: [{ path: "ARTIFACT/a.md", kind: "added" }] } },
  });
  const agent = closed.room.lines.find((line) => line.role === "agent");
  expect(agent?.parts).toEqual(parts);
  expect(agent?.assistantCustom).toEqual({
    agentUpArtifacts: { files: [{ path: "ARTIFACT/a.md", kind: "added" }] },
  });
  const reloaded = store.get("u1", room.id);
  expect(reloaded.lines.find((line) => line.role === "agent")?.parts).toEqual(parts);
});

it("starts a new group session on clear context and keeps the old one out of the model transcript", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-sessions-"));
  const store = new GroupStore(root);
  const room = store.create({ userId: "u1", title: "组", members });
  store.post("u1", room.id, "@产品经理 做登录");
  store.finishHolder("u1", room.id, "登录做好了");
  const cleared = store.resetContext("u1", room.id);
  const sessions = path.join(root, "users", "u1", ".runtime", "groups", room.id, "sessions");
  const names = fs.readdirSync(sessions);
  expect(names).toHaveLength(2);
  expect(names.every((name) => name.endsWith(".jsonl"))).toBe(true);
  expect(cleared.lines.some((line) => line.id.startsWith("context-reset-"))).toBe(true);
  expect(cleared.lines.some((line) => line.text === "登录做好了")).toBe(true);
  expect(cleared.holderId).toBe("pm");
  expect(projectTranscript(cleared)).toBe("");
  store.post("u1", room.id, "@开发 做下一关");
  const next = store.get("u1", room.id);
  expect(projectTranscript(next)).toContain("做下一关");
  expect(projectTranscript(next)).not.toContain("登录做好了");
  expect(next.lines.some((line) => line.text === "登录做好了")).toBe(true);
});
