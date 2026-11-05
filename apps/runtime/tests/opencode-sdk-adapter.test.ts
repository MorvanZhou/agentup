import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { getProviderTemplate } from "../src/config/provider-templates.js";
import { createExternalTranslator } from "../src/session/external/events.js";
import {
  ensureHome,
  hasOpencodeAuth,
  opencodeAuthPaths,
  opencodeHomeDir,
} from "../src/session/external/sdk/adapters/opencode/home.js";
import {
  normalizeOpencodeModels,
  OPENCODE_AUTH_PAGE,
  opencodeModelsOrFallback,
  probeOpencodeAuthPage,
} from "../src/session/external/sdk/adapters/opencode/lifecycle.js";
import {
  opencodeModelOf,
  opencodePromptBodyOf,
  toOpencodeRemoteMcp,
} from "../src/session/external/sdk/adapters/opencode/options.js";
import {
  mirrorOpencodeEvents,
  unwrapOpencodeTool,
} from "../src/session/external/sdk/adapters/opencode/stream.js";
import { getExternalDriver } from "../src/session/external/sdk/registry.js";

it("登录 Key 回落 URL 钉死在 console/account", () => {
  // 改生命周期 AUTH_PAGE 却忘改提示/产品说明时，这条先红
  expect(OPENCODE_AUTH_PAGE).toBe("https://opencode.ai/console/account");
});

it(
  "OpenCode console/account 仍可访问（登录契约哨兵）",
  async () => {
    // 厂商改入口 / 下线账号页时必须失败，提示重审 Key 粘贴接入，而不是静默换 URL
    const probed = await probeOpencodeAuthPage();
    expect(probed.status).toBe(200);
    expect(probed.finalUrl).toMatch(/^https:\/\/([^/]+\.)?opencode\.ai\/console(\/|$)/i);
  },
  20_000,
);

it("probeOpencodeAuthPage：非 console 或非 200 会红", async () => {
  await expect(
    probeOpencodeAuthPage(async () =>
      new Response("<html><title>Gone</title></html>", {
        status: 404,
        statusText: "Not Found",
      }),
    ),
  ).rejects.toThrow(/HTTP 404|登录契约/);

  await expect(
    probeOpencodeAuthPage(async () =>
      new Response("<html><title>Other</title></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
        // Response.url 只读；用自定义对象模拟重定向离开
      }),
    ),
  ).rejects.toThrow(/OpenCode Console|登录契约/);
});

it("OpenCode home 只落在 agentSdkDir 的隔离目录", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-opencode-home-"));
  const home = ensureHome(root, "opencode-sdk");
  expect(home).toBe(opencodeHomeDir(root, "opencode-sdk"));
  expect(home).toContain(path.join("agent-sdks", "opencode-sdk", "opencode-home"));
  expect(home).not.toContain(path.join(".local", "share", "opencode"));

  const authFile = opencodeAuthPaths(root, "opencode-sdk")[0]!;
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  fs.writeFileSync(authFile, JSON.stringify({ opencode: { type: "api", key: "secret" } }));
  expect(hasOpencodeAuth(root, "opencode-sdk")).toBe(true);
});

it("模板与 registry 声明 OpenCode 契约", () => {
  const template = getProviderTemplate("opencode-sdk");
  expect(template?.agentSdk?.driverId).toBe("opencode");
  expect(template?.agentSdk?.skillsProjectRel).toBe(".opencode/skills");
  expect(template?.agentSdk?.companionSpecs).toEqual(["@opencode-ai/sdk@1.19.5"]);
  const driver = getExternalDriver("opencode");
  expect(driver.capabilities.systemPromptMode).toBe("append");
  expect(driver.capabilities.askUserToolNames).toContain("ask_user");
});

it("模型目录只收 opencode provider，并显式回落 default", () => {
  expect(
    normalizeOpencodeModels({
      data: {
        providers: [
          {
            id: "opencode",
            models: {
              "big-pickle": { id: "big-pickle", name: "Big Pickle" },
              "opencode/zen": { id: "opencode/zen", name: "Zen" },
            },
          },
          { id: "anthropic", models: { claude: { id: "claude", name: "Claude" } } },
        ],
      },
    }),
  ).toEqual([
    { id: "opencode/big-pickle", name: "Big Pickle" },
    { id: "opencode/zen", name: "Zen" },
  ]);
  expect(() => opencodeModelsOrFallback([])).toThrow(
    "暂时无法获取可用模型列表，请重新拉取，或手动配置",
  );
});

it("options 拆 provider/model，MCP 使用 headers", () => {
  expect(opencodeModelOf("opencode/zen")).toEqual({
    providerID: "opencode",
    modelID: "zen",
  });
  expect(opencodeModelOf("zen")).toEqual({
    providerID: "opencode",
    modelID: "zen",
  });
  expect(opencodeModelOf("default")).toBeUndefined();
  expect(
    toOpencodeRemoteMcp({
      type: "http",
      url: "http://127.0.0.1:9/mcp",
      headers: { Authorization: "Bearer token" },
    }),
  ).toEqual({
    type: "remote",
    url: "http://127.0.0.1:9/mcp",
    headers: { Authorization: "Bearer token" },
    enabled: true,
    oauth: false,
  });
  const body = opencodePromptBodyOf({
    prompt: "hi",
    cwd: "/tmp/project",
    additionalDirs: [],
    systemAppend: "## Environment\ndarwin",
    modelId: "opencode/zen",
    abortController: new AbortController(),
    userDataRoot: "/tmp",
    templateId: "opencode-sdk",
  });
  expect(body.model).toEqual({ providerID: "opencode", modelID: "zen" });
  expect(body.system).toContain("## Environment");
});

it("SSE 不把 user / transcript 回显当助手正文", async () => {
  async function* events() {
    yield {
      type: "message.updated",
      properties: {
        info: { id: "msg-user", role: "user", sessionID: "ses-1" },
      },
    };
    yield {
      type: "message.part.updated",
      properties: {
        sessionID: "ses-1",
        part: {
          id: "p-user",
          messageID: "msg-user",
          type: "text",
          text: "用户：[会话上下文]\n# Roster search\n用户：hi",
        },
      },
    };
    yield {
      type: "message.updated",
      properties: {
        info: { id: "msg-asst", role: "assistant", sessionID: "ses-1" },
      },
    };
    yield {
      type: "message.part.updated",
      properties: {
        sessionID: "ses-1",
        part: {
          id: "p-asst",
          messageID: "msg-asst",
          type: "text",
          text: "你好，我是助理。",
        },
      },
    };
    yield { type: "session.idle", properties: { sessionID: "ses-1" } };
  }

  const translator = createExternalTranslator();
  for await (const message of mirrorOpencodeEvents(events(), { sessionId: "ses-1" })) {
    translator.push(message);
  }
  expect(translator.text).toBe("你好，我是助理。");
  expect(translator.text).not.toContain("会话上下文");
  expect(translator.text).not.toContain("Roster search");
});

it("SSE 映射正文、AgentUp 工具与 terminal result", async () => {
  async function* events() {
    yield {
      type: "message.updated",
      properties: {
        info: { id: "msg-1", role: "assistant", sessionID: "ses-1" },
      },
    };
    yield {
      type: "message.part.updated",
      properties: {
        sessionID: "ses-1",
        part: { id: "p1", messageID: "msg-1", type: "text", text: "先查一下" },
      },
    };
    yield {
      type: "message.part.updated",
      properties: {
        sessionID: "ses-1",
        part: {
          id: "p2",
          type: "tool",
          callID: "call-1",
          tool: "agentup_agent_search",
          state: { status: "running", input: { query: "天气" } },
        },
      },
    };
    yield {
      type: "message.part.updated",
      properties: {
        sessionID: "ses-1",
        part: {
          id: "p2",
          type: "tool",
          callID: "call-1",
          tool: "agentup_agent_search",
          state: { status: "completed", input: { query: "天气" }, output: "晴" },
        },
      },
    };
    yield { type: "session.idle", properties: { sessionID: "ses-1" } };
  }

  const translator = createExternalTranslator();
  for await (const message of mirrorOpencodeEvents(events(), { sessionId: "ses-1" })) {
    translator.push(message);
  }
  expect(translator.text).toContain("先查一下");
  expect(
    translator.trail.some(
      (item) => item.kind === "tool" && item.name === "mcp__agentup__agent_search",
    ),
  ).toBe(true);
  expect(unwrapOpencodeTool("bash", { command: "pwd" })).toEqual({
    name: "bash",
    args: { command: "pwd" },
  });
});

it("OpenCode 先推空壳 tool 再补参时，落盘仍带扁平 agent_id（协助卡）", async () => {
  // 复现：live SSE 常先 pending/running + input:{}，完成时才有完整参；
  // 若抢先 announce 空壳，trail/UI 永远缺 agent_id，协助 tab 不出现。
  async function* events() {
    yield {
      type: "message.part.updated",
      properties: {
        sessionID: "ses-1",
        part: {
          id: "p-del",
          type: "tool",
          callID: "call-del",
          tool: "agentup_delegate_to_agent",
          state: { status: "pending", input: {}, raw: "" },
        },
      },
    };
    yield {
      type: "message.part.updated",
      properties: {
        sessionID: "ses-1",
        part: {
          id: "p-del",
          type: "tool",
          callID: "call-del",
          tool: "agentup_delegate_to_agent",
          state: { status: "running", input: {} },
        },
      },
    };
    yield {
      type: "message.part.updated",
      properties: {
        sessionID: "ses-1",
        part: {
          id: "p-del",
          type: "tool",
          callID: "call-del",
          tool: "agentup_delegate_to_agent",
          state: {
            status: "completed",
            input: { agent_id: "hJsAC7Ph", brief: "深圳今天天气", wait: true },
            output:
              "task_id: AEIa2XS1\nstatus: completed\nagent: Weaty (hJsAC7Ph)\nresult: 晴 25°C",
          },
        },
      },
    };
    yield { type: "session.idle", properties: { sessionID: "ses-1" } };
  }

  const translator = createExternalTranslator();
  for await (const message of mirrorOpencodeEvents(events(), { sessionId: "ses-1" })) {
    translator.push(message);
  }
  const delegate = translator.trail.find(
    (item) => item.kind === "tool" && item.name === "mcp__agentup__delegate_to_agent",
  );
  expect(delegate?.kind).toBe("tool");
  if (delegate?.kind !== "tool") throw new Error("missing delegate tool");
  expect(delegate.args).toEqual({
    agent_id: "hJsAC7Ph",
    brief: "深圳今天天气",
    wait: true,
  });
  expect(delegate.done).toBe(true);
});

it("OpenCode pending.raw JSON 在 input 空时也能抽出工具参", async () => {
  async function* events() {
    yield {
      type: "message.part.updated",
      properties: {
        sessionID: "ses-1",
        part: {
          id: "p-bash",
          type: "tool",
          callID: "call-bash",
          tool: "bash",
          state: {
            status: "pending",
            input: {},
            raw: JSON.stringify({ command: "node check-weather.mjs 深圳" }),
          },
        },
      },
    };
    yield {
      type: "message.part.updated",
      properties: {
        sessionID: "ses-1",
        part: {
          id: "p-bash",
          type: "tool",
          callID: "call-bash",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "node check-weather.mjs 深圳" },
            output: '{"city":"深圳"}',
          },
        },
      },
    };
    yield { type: "session.idle", properties: { sessionID: "ses-1" } };
  }

  const translator = createExternalTranslator();
  for await (const message of mirrorOpencodeEvents(events(), { sessionId: "ses-1" })) {
    translator.push(message);
  }
  const bash = translator.trail.find(
    (item) => item.kind === "tool" && item.name === "bash",
  );
  expect(bash?.kind).toBe("tool");
  if (bash?.kind !== "tool") throw new Error("missing bash tool");
  expect(bash.args).toEqual({ command: "node check-weather.mjs 深圳" });
});

it("question.asked 使用真实 callID，并把归一题型交给 AskUser", async () => {
  async function* events() {
    yield {
      type: "question.asked",
      properties: {
        id: "request-1",
        sessionID: "ses-1",
        tool: { messageID: "msg-1", callID: "question-call-1" },
        questions: [
          {
            question: "谁来做？",
            header: "执行人",
            options: [{ label: "Weaty", description: "气象员" }],
            multiple: false,
          },
        ],
      },
    };
    yield { type: "session.idle", properties: { sessionID: "ses-1" } };
  }
  const seen: unknown[] = [];
  const messages: unknown[] = [];
  for await (const message of mirrorOpencodeEvents(events(), {
    sessionId: "ses-1",
    onQuestion: async (input) => {
      seen.push(input);
      return "User answered:\n1. 谁来做？ → Weaty";
    },
  })) {
    messages.push(message);
  }
  expect(seen).toEqual([
    {
      requestId: "request-1",
      toolCallId: "question-call-1",
      questions: [
        {
          question: "谁来做？",
          context: "执行人",
          options: [{ title: "Weaty", description: "气象员" }],
          allowMultiple: false,
        },
      ],
    },
  ]);
  expect(JSON.stringify(messages)).toContain("question-call-1");
  expect(JSON.stringify(messages)).toContain("User answered:");
});
