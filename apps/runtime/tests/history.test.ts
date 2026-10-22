import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";

import { startLocalServer } from "../src/local/server.js";
import {
  clearContext,
  clearHistory,
  CONTEXT_RESET_TEXT,
  healInterruptedSessionTools,
  INTERRUPTED_ASK_USER_RESULT,
  INTERRUPTED_TOOL_RESULT,
  projectHistory,
  readHistory,
} from "../src/session/history/history.js";

const assistantBase = {
  api: "openai-completions",
  provider: "ollama",
  model: "qwen3:0.6b",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  timestamp: 0,
};

function visitDirs(root: string, userId: string, agentId = "weather") {
  const visit = path.join(root, "users", userId, "agents", agentId);
  const cwd = path.join(visit, "cwd");
  const sessions = path.join(visit, "sessions");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(sessions, { recursive: true });
  return { cwd, sessions };
}

function writeTurn(cwd: string, sessions: string, question: string, answer: string, at = Date.UTC(2026, 9, 12, 7, 0, 0)) {
  const manager = SessionManager.continueRecent(cwd, sessions);
  manager.appendMessage({ role: "user", content: question, timestamp: at } as never);
  manager.appendMessage({
    ...assistantBase,
    timestamp: at + 1_000,
    role: "assistant",
    stopReason: "toolUse",
    content: [
      { type: "thinking", thinking: "先查天气" },
      { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "node check-weather.mjs 上海" } },
    ],
  } as never);
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "bash",
    content: [{ type: "text", text: '{"city":"上海"}' }],
    isError: false,
    timestamp: at + 2_000,
  } as never);
  manager.appendMessage({
    ...assistantBase,
    timestamp: at + 3_000,
    role: "assistant",
    stopReason: "stop",
    content: [{ type: "text", text: answer }],
  } as never);
}

function textOf(message: { parts: Array<{ type: string; text?: string }> }): string {
  return message.parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
}

it("reads the latest Pi session and keeps appending to it after a restart", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-history-"));
  const { cwd, sessions } = visitDirs(root, "user-a");
  expect(await readHistory(root, "user-a", "weather")).toEqual([]);
  expect(fs.readdirSync(sessions)).toEqual([]);

  writeTurn(cwd, sessions, "上海天气？", "上海晴。");
  writeTurn(cwd, sessions, "北京呢？", "北京多云。");

  expect(fs.readdirSync(sessions)).toHaveLength(1);
  const history = await readHistory(root, "user-a", "weather");
  expect(history.map((message) => [message.role, textOf(message)])).toEqual([
    ["user", "上海天气？"],
    ["assistant", "上海晴。"],
    ["user", "北京呢？"],
    ["assistant", "北京多云。"],
  ]);
  expect(history[1]?.parts).toMatchObject([
    { type: "reasoning", text: "先查天气" },
    {
      type: "dynamic-tool",
      toolCallId: "call-1",
      toolName: "bash",
      state: "output-available",
      input: { command: "node check-weather.mjs 上海" },
      output: '{"city":"上海"}',
    },
    { type: "text", text: "上海晴。" },
  ]);
  expect(history[0]?.metadata).toMatchObject({
    custom: { agentUpCreatedAt: new Date(Date.UTC(2026, 9, 12, 7, 0, 0)).toISOString() },
  });
  expect(history[1]?.metadata).toMatchObject({
    custom: { agentUpCreatedAt: new Date(Date.UTC(2026, 9, 12, 7, 0, 1)).toISOString() },
  });
  // user 消息 id 即 Pi entry id，供编辑重发 rewind
  expect(typeof history[0]?.id).toBe("string");
  expect(history[0]?.id).not.toMatch(/-user-/);
  expect(history[0]?.metadata).toMatchObject({
    custom: { agentUpEntryId: history[0]?.id },
  });
});

it("wipes session files on clearHistory and leaves cwd alone", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-history-wipe-"));
  const { cwd, sessions } = visitDirs(root, "user-a");
  fs.writeFileSync(path.join(cwd, "notes.txt"), "keep me");
  writeTurn(cwd, sessions, "上海天气？", "上海晴。");
  clearContext(root, "user-a", "weather");
  expect(fs.readdirSync(sessions).length).toBeGreaterThan(0);

  clearHistory(root, "user-a", "weather");
  expect(fs.readdirSync(sessions)).toEqual([]);
  expect(await readHistory(root, "user-a", "weather")).toEqual([]);
  expect(fs.readFileSync(path.join(cwd, "notes.txt"), "utf8")).toBe("keep me");
});

it("keeps old turns visible after clearContext and marks the reset boundary", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-history-"));
  const { cwd, sessions } = visitDirs(root, "user-a");
  writeTurn(cwd, sessions, "上海天气？", "上海晴。");
  clearContext(root, "user-a", "weather");
  expect(fs.readdirSync(sessions).filter((name) => name.endsWith(".jsonl")).length).toBeGreaterThanOrEqual(2);

  const cleared = await readHistory(root, "user-a", "weather");
  expect(cleared.map((message) => [message.role, textOf(message)])).toEqual([
    ["user", "上海天气？"],
    ["assistant", "上海晴。"],
    ["system", CONTEXT_RESET_TEXT],
  ]);
  expect(cleared[2]?.metadata).toMatchObject({ custom: { agentUpKind: "context-reset" } });

  writeTurn(cwd, sessions, "北京呢？", "北京多云。");
  const continued = await readHistory(root, "user-a", "weather");
  expect(continued.map((message) => [message.role, textOf(message)])).toEqual([
    ["user", "上海天气？"],
    ["assistant", "上海晴。"],
    ["system", CONTEXT_RESET_TEXT],
    ["user", "北京呢？"],
    ["assistant", "北京多云。"],
  ]);
});

it("settles unfinished ask_user / tool calls after app exit", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-history-interrupt-"));
  const { cwd, sessions } = visitDirs(root, "user-a");
  const manager = SessionManager.continueRecent(cwd, sessions);
  manager.appendMessage({ role: "user", content: "先问我", timestamp: Date.UTC(2026, 9, 12, 8, 0, 0) } as never);
  manager.appendMessage({
    ...assistantBase,
    timestamp: Date.UTC(2026, 9, 12, 8, 0, 1),
    role: "assistant",
    stopReason: "toolUse",
    content: [
      {
        type: "toolCall",
        id: "call-ask",
        name: "ask_user",
        arguments: {
          questions: [
            {
              question: "用哪个模板？",
              options: [{ title: "A" }, { title: "B" }],
              allowMultiple: false,
            },
          ],
        },
      },
      {
        type: "toolCall",
        id: "call-bash",
        name: "bash",
        arguments: { command: "pwd" },
      },
    ],
  } as never);

  expect(healInterruptedSessionTools(manager)).toBe(2);
  expect(healInterruptedSessionTools(manager)).toBe(0);

  const history = await readHistory(root, "user-a", "weather");
  expect(history).toHaveLength(2);
  expect(history[1]?.parts).toMatchObject([
    {
      type: "dynamic-tool",
      toolCallId: "call-ask",
      toolName: "ask_user",
      state: "output-available",
      output: INTERRUPTED_ASK_USER_RESULT,
    },
    {
      type: "dynamic-tool",
      toolCallId: "call-bash",
      toolName: "bash",
      state: "output-available",
      output: INTERRUPTED_TOOL_RESULT,
    },
  ]);
});

it("projectHistory maps user ImageContent to file parts", () => {
  const png = Buffer.from([0x89, 0x50]).toString("base64");
  const messages = projectHistory([
    {
      role: "user",
      content: [
        { type: "text", text: "你知道这图是什么吗" },
        { type: "image", data: png, mimeType: "image/png" },
      ],
      timestamp: 1,
    },
  ]);
  expect(messages[0]?.parts).toEqual([
    { type: "text", text: "你知道这图是什么吗" },
    {
      type: "file",
      mediaType: "image/png",
      url: `data:image/png;base64,${png}`,
      filename: "image-1.png",
    },
  ]);
});

it("projectHistory attaches agentUpSummary from __agentUpSummary", () => {
  const messages = projectHistory([
    { role: "user", content: "hi", timestamp: 1 },
    {
      role: "assistant",
      content: [
        { type: "text", text: "中间" },
        { type: "text", text: "总结" },
      ],
      timestamp: 2,
      __agentUpSummary: { textPartIndex: 1 },
    },
  ]);
  expect(messages[1]?.metadata).toMatchObject({
    custom: { agentUpSummary: { textPartIndex: 1 } },
  });
});

it("projectHistory marks dangling tool parts even without healing", () => {
  const messages = projectHistory([
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "call-1", name: "ask_user", arguments: { questions: [] } },
        { type: "toolCall", id: "call-2", name: "read", arguments: { path: "a" } },
      ],
      timestamp: 1,
    },
  ]);
  expect(messages[0]?.parts).toMatchObject([
    {
      type: "dynamic-tool",
      toolName: "ask_user",
      state: "output-available",
      output: INTERRUPTED_ASK_USER_RESULT,
    },
    {
      type: "dynamic-tool",
      toolName: "read",
      state: "output-available",
      output: INTERRUPTED_TOOL_RESULT,
    },
  ]);
});

it("fills empty connection-error assistants with model-unavailable notice", () => {
  const messages = projectHistory([
    { role: "user", content: "日本汇率", timestamp: 1 },
    {
      ...assistantBase,
      role: "assistant",
      stopReason: "error",
      errorMessage: "Connection error.",
      content: [],
      timestamp: 2,
    },
  ]);
  expect(textOf(messages[1]!)).toContain("切换模型");
});

it("serves history per user from local files only", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-history-"));
  const a = visitDirs(root, "user-a");
  visitDirs(root, "user-b");
  writeTurn(a.cwd, a.sessions, "上海天气？", "上海晴。");
  const local = await startLocalServer({ backendUrl: "http://127.0.0.1:9", userDataRoot: root, host: "127.0.0.1", port: 0 });
  try {
    const read = (query: string, token = "token") =>
      fetch(`${local.url}/agents/weather/history?${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    const own = await read("user_id=user-a");
    expect(own.status).toBe(200);
    const payload = (await own.json()) as { messages: Array<{ parts: Array<{ type: string; text?: string }> }> };
    expect(payload.messages.map(textOf)).toEqual(["上海天气？", "上海晴。"]);
    expect(await (await read("user_id=user-b")).json()).toEqual({ messages: [] });
    expect(await (await read("user_id=nobody")).json()).toEqual({ messages: [] });
    expect((await read("user_id=..")).status).toBe(400);
    expect((await read("user_id=user-a", "")).status).toBe(401);

    const wiped = await fetch(`${local.url}/agents/weather/history?user_id=user-a`, {
      method: "DELETE",
      headers: { authorization: "Bearer token" },
    });
    expect(wiped.status).toBe(200);
    expect(await wiped.json()).toEqual({ cleared: true });
    expect(await (await read("user_id=user-a")).json()).toEqual({ messages: [] });
    expect(fs.readdirSync(a.sessions)).toEqual([]);
  } finally {
    await local.close();
  }
});
