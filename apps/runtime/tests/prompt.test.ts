import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";

import { setModelEnabled, upsertProviderConnection } from "../src/config/provider.js";
import { startLocalServer } from "../src/local/server.js";
import { packTarGz } from "../src/package/archive.js";
import { packageDigest } from "../src/package/digest.js";
import type { Visit } from "../src/package/sync.js";
import { VisitChats, type PromptSession } from "../src/session/turn/index.js";

const manifest = { version: 1, tools: [] as string[], modelCapabilities: [] as string[] };
const files = { "SYSTEM.md": Buffer.from("你是呼吸科医生") };
const digest = packageDigest(manifest, files);
const archivePromise = packTarGz(files);
const model = {
  providerId: "ollama",
  templateId: "ollama",
  modelId: "qwen",
  apiKey: "ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  kind: "ollama" as const,
};

/** prompt 路由按 visit 解析已启用模型；HTTP 测例需先落盘连接。 */
function seedModel(userDataRoot: string): void {
  upsertProviderConnection(userDataRoot, {
    templateId: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    customModelId: "qwen",
  });
  setModelEnabled(userDataRoot, { templateId: "ollama", modelId: "qwen" }, true);
}

it("streams a Pi turn without calling the model", async () => {
  const backend = await listen(backendHandler);
  const root = path.join(os.tmpdir(), `agentup-prompt-${Date.now()}`);
  seedModel(root);
  const seen: string[] = [];
  const local = await startLocalServer(
    { backendUrl: `http://127.0.0.1:${backend.address.port}`, userDataRoot: root, host: "127.0.0.1", port: 0 },
    {
      openPrompt: async () => scriptedSession(seen),
    },
  );
  try {
    const account = await createAccount(local.url, "patient-a@example.com", "secret");
    await post(local.url, "/agents/respiratory-doctor/recruit", {}, account.token as string);
    await post(local.url, "/agents/respiratory-doctor/sync", { user_id: account.user_id }, account.token as string);
    const response = await fetch(`${local.url}/agents/respiratory-doctor/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${account.token}` },
      body: JSON.stringify({ user_id: account.user_id, text: "你好" }),
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const chunks = parseSse(await response.text());
    expect(chunks.map((chunk) => chunk.type).filter((type) => type !== "message-metadata")).toEqual([
      "start",
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "tool-input-available",
      "tool-output-available",
      "finish-step",
      "finish",
    ]);
    expect(chunks.find((chunk) => chunk.type === "text-delta")).toMatchObject({ delta: "你好" });
    expect(chunks.find((chunk) => chunk.type === "tool-input-available")).toMatchObject({
      toolName: "read",
      input: { path: "note" },
    });
    expect(chunks.find((chunk) => chunk.type === "tool-output-available")).toMatchObject({ output: "病历" });
    expect(seen).toEqual(["你好"]);
    expect((await post(local.url, "/messages", { text: "你好" }, account.token as string)).status).toBe(404);
  } finally {
    await local.close();
    await close(backend);
  }
});

it("trims prompt text before handing it to the session", async () => {
  const seen: string[] = [];
  const chats = new VisitChats(async () => scriptedSession(seen));
  const stream = await chats.promptStream(visitFixture(), model, "  你好  \n");
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    /* drain */
  }
  expect(seen).toEqual(["你好"]);
});

it("passes images to Pi prompt without appending path suffix text", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-prompt-attach-"));
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(cwd, { recursive: true });
  const seen: Array<{ text: string; images?: unknown }> = [];
  const chats = new VisitChats(async () => {
    let listener: (event: AgentSessionEvent) => void = () => undefined;
    return {
      subscribe(next) {
        listener = next;
        return () => undefined;
      },
      async prompt(text, options) {
        seen.push({ text, images: options?.images });
        listener({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "看到了" },
        } as AgentSessionEvent);
      },
      async abort() {},
      dispose() {},
    };
  });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
  const stream = await chats.promptStream(
    { ...visitFixture(), root },
    model,
    "你知道这图是什么吗",
    undefined,
    undefined,
    [{ name: "shot.png", mediaType: "image/png", dataBase64: png }],
  );
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    /* drain */
  }
  expect(seen).toHaveLength(1);
  expect(seen[0]?.text).toBe("你知道这图是什么吗");
  expect(seen[0]?.text).not.toContain("[附件已保存]");
  expect(seen[0]?.images).toEqual([{ type: "image", data: png, mimeType: "image/png" }]);
  const files = fs.readdirSync(path.join(cwd, "ATTACHMENTS"));
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/^shot_[a-f0-9]{8}\.png$/i);
});

it("reopens the private assistant session after its resources are invalidated", async () => {
  let opens = 0;
  const chats = new VisitChats(async () => {
    opens += 1;
    return scriptedSession([]);
  });
  const visit = { ...visitFixture(), kind: "personal" as const, agentId: "personal-assistant" };
  const first = await chats.promptStream(visit, model, "第一轮");
  const firstReader = first.getReader();
  while (!(await firstReader.read()).done) {
    /* drain */
  }
  expect(opens).toBe(1);
  chats.invalidatePersonalAssistant(visit.userId);
  const second = await chats.promptStream(visit, model, "第二轮");
  const secondReader = second.getReader();
  while (!(await secondReader.read()).done) {
    /* drain */
  }
  expect(opens).toBe(2);
});

it("keeps the visit busy until Pi prompt finishes even if the HTTP consumer cancels", async () => {
  let releasePrompt: () => void = () => undefined;
  const promptGate = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });
  const seen: string[] = [];
  const chats = new VisitChats(async () => ({
    subscribe() {
      return () => undefined;
    },
    async prompt(text) {
      seen.push(text);
      await promptGate;
    },
    async abort() {},
    dispose() {},
  }));
  const visit = visitFixture();
  const stream = await chats.promptStream(visit, model, "第一轮");
  const reader = stream.getReader();
  await reader.cancel("client navigated away");
  expect(chats.busy(visit.userId, visit.agentId)).toBe(true);
  await expect(chats.promptStream(visit, model, "第二轮")).rejects.toThrow("正在回复");
  releasePrompt();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(chats.busy(visit.userId, visit.agentId)).toBe(false);
  const next = await chats.promptStream(visit, model, "第二轮");
  const nextReader = next.getReader();
  while (!(await nextReader.read()).done) {
    /* drain */
  }
  expect(seen).toEqual(["第一轮", "第二轮"]);
});

it("aborts the Pi turn when the prompt AbortSignal fires so a new turn can start", async () => {
  let releasePrompt: () => void = () => undefined;
  const promptGate = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });
  let aborted = false;
  const seen: string[] = [];
  const chats = new VisitChats(async () => ({
    subscribe() {
      return () => undefined;
    },
    async prompt(text) {
      seen.push(text);
      await promptGate;
    },
    async abort() {
      aborted = true;
      releasePrompt();
    },
    dispose() {},
  }));
  const visit = visitFixture();
  const cancel = new AbortController();
  const stream = await chats.promptStream(visit, model, "第一轮", cancel.signal);
  const reader = stream.getReader();
  void reader.read();
  expect(chats.busy(visit.userId, visit.agentId)).toBe(true);
  cancel.abort();
  await chats.abort(visit.userId, visit.agentId);
  expect(aborted).toBe(true);
  expect(chats.busy(visit.userId, visit.agentId)).toBe(false);
  const next = await chats.promptStream(visit, model, "第二轮");
  const nextReader = next.getReader();
  while (!(await nextReader.read()).done) {
    /* drain */
  }
  expect(seen).toEqual(["第一轮", "第二轮"]);
});

it("VisitChats.abort waits until busy clears so context reset can proceed", async () => {
  let releasePrompt: () => void = () => undefined;
  const promptGate = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });
  const chats = new VisitChats(async () => ({
    subscribe() {
      return () => undefined;
    },
    async prompt() {
      await promptGate;
    },
    async abort() {
      releasePrompt();
    },
    dispose() {},
  }));
  const visit = visitFixture();
  const stream = await chats.promptStream(visit, model, "第一轮");
  void stream.getReader().read();
  expect(chats.busy(visit.userId, visit.agentId)).toBe(true);
  await chats.abort(visit.userId, visit.agentId);
  expect(chats.busy(visit.userId, visit.agentId)).toBe(false);
  chats.release(visit.userId, visit.agentId);
  expect(chats.busy(visit.userId, visit.agentId)).toBe(false);
});

it("aborts Pi on client disconnect so the next prompt and context reset both work", async () => {
  let releasePrompt: () => void = () => undefined;
  let turnStarted: () => void = () => undefined;
  const promptGate = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });
  const started = new Promise<void>((resolve) => {
    turnStarted = resolve;
  });
  const seen: string[] = [];
  const backend = await listen(backendHandler);
  const root = path.join(os.tmpdir(), `agentup-prompt-abort-${Date.now()}`);
  seedModel(root);
  const local = await startLocalServer(
    { backendUrl: `http://127.0.0.1:${backend.address.port}`, userDataRoot: root, host: "127.0.0.1", port: 0 },
    {
      openPrompt: async () => ({
        subscribe() {
          return () => undefined;
        },
        async prompt(text) {
          seen.push(text);
          turnStarted();
          await promptGate;
        },
        async abort() {
          releasePrompt();
        },
        dispose() {},
      }),
    },
  );
  try {
    const account = await createAccount(local.url, "patient-a@example.com", "secret");
    await post(local.url, "/agents/respiratory-doctor/recruit", {}, account.token as string);
    await post(local.url, "/agents/respiratory-doctor/sync", { user_id: account.user_id }, account.token as string);
    const controller = new AbortController();
    // 首 chunk 前 headers 可能未刷出，不要 await response；等 turn 真正开始再断开。
    const promptPromise = fetch(`${local.url}/agents/respiratory-doctor/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${account.token}` },
      body: JSON.stringify({ user_id: account.user_id, text: "第一轮" }),
      signal: controller.signal,
    });
    await started;
    controller.abort();
    await promptPromise.catch(() => undefined);
    // 等 disconnect → session.abort 解开 busy（不依赖清上下文）
    for (let i = 0; i < 50; i += 1) {
      const again = await fetch(`${local.url}/agents/respiratory-doctor/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${account.token}` },
        body: JSON.stringify({ user_id: account.user_id, text: "第二轮" }),
      });
      if (again.status !== 409) {
        await again.text();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(seen).toEqual(["第一轮", "第二轮"]);
    const cleared = await post(
      local.url,
      "/agents/respiratory-doctor/context",
      { user_id: account.user_id },
      account.token as string,
    );
    expect(cleared).toMatchObject({ status: 200, cleared: true });
  } finally {
    await local.close();
    await close(backend);
  }
});

it("refuses to open a session before a local model is configured", async () => {
  const backend = await listen(backendHandler);
  const root = path.join(os.tmpdir(), `agentup-prompt-model-${Date.now()}`);
  // 故意不 seedModel：visit 解析不到已启用模型时应 503。
  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const account = await createAccount(local.url, "patient-a@example.com", "secret");
    await post(local.url, "/agents/respiratory-doctor/recruit", {}, account.token as string);
    await post(local.url, "/agents/respiratory-doctor/sync", { user_id: account.user_id }, account.token as string);
    const response = await post(local.url, "/agents/respiratory-doctor/prompt", { user_id: account.user_id, text: "你好" }, account.token as string);
    expect(response).toMatchObject({ status: 503, error: "打开会话前请先在设置中连接服务商并启用一个模型" });
  } finally {
    await local.close();
    await close(backend);
  }
});

function visitFixture(): Visit {
  return {
    userId: "patient-a",
    agentId: "respiratory-doctor",
    root: path.join(os.tmpdir(), "agentup-prompt-visit"),
    packageVersion: 1,
    packageDigest: digest,
    tools: ["read"],
    modelCapabilities: ["tools"],
    projectTrust: "granted",
  };
}

function scriptedSession(seen: string[]): PromptSession {
  let listener: (event: AgentSessionEvent) => void = () => undefined;
  return {
    subscribe(next) {
      listener = next;
      return () => undefined;
    },
    async prompt(text) {
      seen.push(text);
      listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "你好" } } as AgentSessionEvent);
      listener({ type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: { path: "note" } } as AgentSessionEvent);
      listener({
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "read",
        result: { content: [{ type: "text", text: "病历" }] },
        isError: false,
      } as AgentSessionEvent);
    },
    async abort() {},
    dispose() {},
  };
}

function backendHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
  const token = req.headers.authorization?.slice("Bearer ".length);
  if (req.url === "/v1/register") {
    json(res, 200, { email: "patient-a@example.com", status: "pending_verification" });
    return;
  }
  if (req.url === "/v1/login") {
    json(res, 200, {
      user_id: "patient-a",
      email: "patient-a@example.com",
      nickname: "patient-a",
      token: "patient-a",
    });
    return;
  }
  if (!token) {
    json(res, 401, { error: "未登录" });
    return;
  }
  if (req.url === "/v1/agents/respiratory-doctor/recruit") {
    json(res, 200, { user_id: token, agent_id: "respiratory-doctor", name: "呼吸科医生", latest_version: manifest.version, latest_digest: digest });
    return;
  }
  if (req.url === "/v1/recruits") {
    json(res, 200, { recruits: [{ user_id: token, agent_id: "respiratory-doctor", name: "呼吸科医生", latest_version: manifest.version, latest_digest: digest }] });
    return;
  }
  if (req.url?.startsWith("/v1/agents/respiratory-doctor/package")) {
    void archivePromise.then((archive) => {
      const body = Buffer.from(archive);
      res.writeHead(200, {
        "content-type": "application/gzip",
        "content-length": body.length,
        "x-agent-id": "respiratory-doctor",
        "x-package-version": String(manifest.version),
        "x-package-digest": digest,
        "x-package-name": encodeURIComponent("呼吸科医生"),
        "x-package-background": encodeURIComponent("演示问诊"),
      });
      res.end(body);
    });
    return;
  }
  json(res, 404, { error: "没有这个接口" });
}

/** 注册仅返回 pending；测业务时用 login 拿 session（不依赖真实邮件验证）。 */
async function createAccount(base: string, email: string, password: string) {
  const pending = await post(base, "/register", { email, password });
  expect(pending).toMatchObject({ email, status: "pending_verification" });
  return post(base, "/login", { email, password });
}

async function post(base: string, pathName: string, body: Record<string, unknown>, token?: string) {
  const response = await fetch(`${base}${pathName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, ...(await response.json() as Promise<Record<string, unknown>>) };
}

function json(res: http.ServerResponse, status: number, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { "content-type": "application/json", "content-length": body.length });
  res.end(body);
}

function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  return new Promise<{ server: http.Server; address: AddressInfo }>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, address: server.address() as AddressInfo }));
  });
}

function close(running: { server: http.Server }) {
  return new Promise<void>((resolve, reject) => {
    running.server.close((error) => (error ? reject(error) : resolve()));
  });
}

function parseSse(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
}
