import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { getProviderTemplate } from "../src/config/provider-templates.js";
import {
  clearDshApiKey,
  dshHomeDir,
  ensureDshHome,
  hasDshApiKey,
  readDshApiKey,
  writeDshApiKey,
} from "../src/session/external/sdk/adapters/dsh/home.js";
import {
  DSH_API_KEY_PAGE,
  dshModelsFallback,
} from "../src/session/external/sdk/adapters/dsh/lifecycle.js";
import { resolveEsmEntryUrl } from "../src/session/external/sdk/adapters/dsh/load.js";
import {
  DSH_CONTEXT_HEADER,
  dshAskUserRequestToQuestions,
  dshHarnessOptionsOf,
  systemPromptOf,
  toDshUserQuestionResult,
  writeAgentUpMcpPatch,
} from "../src/session/external/sdk/adapters/dsh/options.js";
import {
  projectDshNotification,
  rewriteAskUserResultText,
  unwrapDshMcpTool,
} from "../src/session/external/sdk/adapters/dsh/stream.js";
import { getExternalDriver } from "../src/session/external/sdk/registry.js";

it("API Key 页钉死在 platform.deepseek.com/api_keys", () => {
  expect(DSH_API_KEY_PAGE).toBe("https://platform.deepseek.com/api_keys");
});

it("模板 deepseek-harness-sdk 声明 driverId=dsh 与 .dsh/skills", () => {
  const template = getProviderTemplate("deepseek-harness-sdk");
  expect(template?.access).toBe("agent-sdk");
  // 与官方 API（vendorId=deepseek）分开，Desktop 标形可区分
  expect(template?.vendorId).toBe("deepseek-harness");
  expect(template?.label).toBe("DeepSeek Harness");
  expect(template?.agentSdk?.driverId).toBe("dsh");
  expect(template?.agentSdk?.package).toBe("@deepseek-ai/dsh-sdk-client");
  expect(template?.agentSdk?.skillsProjectRel).toBe(".dsh/skills");
  expect(template?.agentSdk?.spec).toContain("@deepseek-ai/dsh-sdk-client@0.2.2-rc.1");
  expect(template?.agentSdk?.apiKeyPaste).toBe("deepseek");
  expect(template?.defaultModelId).toBe("deepseek-flash");
});

it("registry 能取到 dsh driver，systemPromptMode=replace", () => {
  const driver = getExternalDriver("dsh");
  expect(driver.capabilities.driverId).toBe("dsh");
  expect(driver.capabilities.systemPromptMode).toBe("replace");
  expect(driver.capabilities.askUserToolNames).toEqual([
    "ask_user",
    "ask_user_question",
    "AskUserQuestion",
  ]);
});

it("home 只落在 agentSdkDir 隔离目录，Key 可读写", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-dsh-home-"));
  const home = ensureDshHome(root, "deepseek-harness-sdk");
  expect(home).toBe(dshHomeDir(root, "deepseek-harness-sdk"));
  expect(home).toContain(path.join("agent-sdks", "deepseek-harness-sdk", "dsh-home"));
  expect(hasDshApiKey(root, "deepseek-harness-sdk")).toBe(false);

  writeDshApiKey(root, "deepseek-harness-sdk", "sk-test-key", "DeepSeek");
  expect(hasDshApiKey(root, "deepseek-harness-sdk")).toBe(true);
  expect(readDshApiKey(root, "deepseek-harness-sdk")).toBe("sk-test-key");

  clearDshApiKey(root, "deepseek-harness-sdk");
  expect(hasDshApiKey(root, "deepseek-harness-sdk")).toBe(false);
});

it("resolveEsmEntryUrl 直接读安装目录 package.json", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-dsh-esm-"));
  const pkgDir = path.join(root, "node_modules", "@deepseek-ai", "dsh-sdk-client");
  fs.mkdirSync(path.join(pkgDir, "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: "@deepseek-ai/dsh-sdk-client",
      exports: {
        ".": { import: "./lib/index.js", require: "./lib/index.js" },
      },
    }),
  );
  fs.writeFileSync(path.join(pkgDir, "lib", "index.js"), "export {};\n");
  const url = resolveEsmEntryUrl(root, "@deepseek-ai/dsh-sdk-client");
  expect(url.startsWith("file://")).toBe(true);
  expect(url.endsWith("/lib/index.js")).toBe(true);
});

it("列模型 curated：V4.1 Flash + V4 Pro（无活 list，≠ 拉失败回落）", () => {
  const models = dshModelsFallback();
  expect(models).toEqual([
    {
      id: "deepseek-flash",
      name: "DeepSeek V4.1 Flash",
      contextWindow: 1_000_000,
      maxTokens: 384_000,
    },
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      contextWindow: 1_000_000,
      maxTokens: 384_000,
    },
  ]);
});

it("systemPrompt 走 replace：header + Host append", () => {
  const prompt = systemPromptOf({
    prompt: "hi",
    cwd: "/tmp/proj",
    additionalDirs: [],
    systemAppend: "## Environment\ndarwin",
    abortController: new AbortController(),
    userDataRoot: "/tmp",
    templateId: "deepseek-harness-sdk",
  });
  expect(prompt.startsWith(DSH_CONTEXT_HEADER)).toBe(true);
  expect(prompt).toContain("## Environment");
});

it("cordis patch：personaPrefix 读 DSH_SYSTEM_PROMPT + insert MCP", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-dsh-mcp-"));
  const home = ensureDshHome(root, "deepseek-harness-sdk");
  writeDshApiKey(root, "deepseek-harness-sdk", "sk-test");
  const patch = writeAgentUpMcpPatch(
    {
      prompt: "hi",
      cwd: "/tmp/proj",
      additionalDirs: [],
      systemAppend: "",
      abortController: new AbortController(),
      userDataRoot: root,
      templateId: "deepseek-harness-sdk",
      mcpServer: {
        type: "http",
        url: "http://127.0.0.1:9/mcp",
        headers: { Authorization: "Bearer t" },
      },
    },
    home,
  );
  expect(patch).toBeTruthy();
  const body = fs.readFileSync(patch!, "utf8");
  // 完整 sdk 须覆盖 system-prompt；MCP 必须 insert（非裸顶层 id）
  expect(body).toContain("- id: system-prompt");
  expect(body).toContain("personaPrefix: !!js process.env.DSH_SYSTEM_PROMPT");
  expect(body).toContain("- insert:");
  expect(body).toContain("id: mcp-agentup");
  expect(body).toContain("serverName: agentup");
  expect(body).toContain("streamable-http");
  expect(body).toContain("http://127.0.0.1:9/mcp");
  expect(body).toContain("Authorization");
  expect(body).toContain("failOnStartupError: true");
});

it("无 MCP 仍写 personaPrefix patch（避免上下文静默丢）", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-dsh-persona-"));
  const home = ensureDshHome(root, "deepseek-harness-sdk");
  const patch = writeAgentUpMcpPatch(
    {
      prompt: "hi",
      cwd: "/tmp/proj",
      additionalDirs: [],
      systemAppend: "ctx",
      abortController: new AbortController(),
      userDataRoot: root,
      templateId: "deepseek-harness-sdk",
    },
    home,
  );
  const body = fs.readFileSync(patch!, "utf8");
  expect(body).toContain("personaPrefix: !!js process.env.DSH_SYSTEM_PROMPT");
  expect(body).not.toContain("mcp-agentup");
});

it("harness options：profile=sdk、不 resume、approvalRequests", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-dsh-opts-"));
  writeDshApiKey(root, "deepseek-harness-sdk", "sk-test");
  const { options } = dshHarnessOptionsOf({
    prompt: "hi",
    cwd: "/tmp/proj",
    additionalDirs: ["/tmp/extra"],
    systemAppend: "ctx",
    modelId: "deepseek-flash",
    abortController: new AbortController(),
    userDataRoot: root,
    templateId: "deepseek-harness-sdk",
  });
  expect(options.profile).toBe("sdk");
  expect(options.cwd).toBe("/tmp/proj");
  expect(options.provider).toBe("deepseek-official");
  expect(options.model).toBe("deepseek-flash");
  expect(options.approvalRequests).toBe(true);
  expect(options.dshHome).toContain("dsh-home");
  expect(options.patches).toEqual([
    expect.stringContaining("agentup-mcp.cordis.yml"),
  ]);
  const env = options.env as NodeJS.ProcessEnv;
  expect(env.DEEPSEEK_API_KEY).toBe("sk-test");
  expect(env.DSH_SYSTEM_PROMPT).toContain(DSH_CONTEXT_HEADER);
});

it("AskUser：requestId 作 toolCallId；答案回填厂商 id", () => {
  const mapped = dshAskUserRequestToQuestions({
    requestId: "req-1",
    sessionId: "s1",
    questions: [
      {
        id: "q-color",
        question: "Pick a color",
        options: [{ label: "Red" }, { label: "Blue" }],
      },
    ],
  });
  expect(mapped?.toolCallId).toBe("req-1");
  expect(mapped?.ids).toEqual(["q-color"]);
  expect(mapped?.questions[0]?.question).toBe("Pick a color");
  expect(mapped?.questions[0]?.options.map((o) => o.title)).toEqual(["Red", "Blue"]);

  const result = toDshUserQuestionResult(["q-color"], {
    kind: "answers",
    items: [{ kind: "selection", selections: ["Blue"] }],
  });
  expect(result).toEqual({
    answers: [{ id: "q-color", selected: ["Blue"] }],
  });
});

it("MCP 工具名保持 mcp__agentup__*；空参延迟 announce", () => {
  expect(unwrapDshMcpTool("mcp__agentup__delegate_to_agent", { agent_id: "a" })).toEqual({
    name: "mcp__agentup__delegate_to_agent",
    args: { agent_id: "a" },
  });
  expect(unwrapDshMcpTool("delegate_to_agent", { agent_id: "a" }).name).toBe(
    "mcp__agentup__delegate_to_agent",
  );
  expect(unwrapDshMcpTool("ask_user_question", {}).name).toBe("ask_user");

  const pending = new Map();
  // 空参不抢先 announce
  expect(
    projectDshNotification(
      {
        method: "session.event",
        params: {
          event: {
            type: "tool/call",
            data: { callId: "c1", name: "mcp__agentup__delegate_to_agent", arguments: "{}" },
          },
        },
      },
      pending,
    ),
  ).toEqual([]);
  // 补参 / terminal 再 announce
  const late = projectDshNotification(
    {
      method: "session.event",
      params: {
        event: {
          type: "tool/result",
          data: {
            callId: "c1",
            message: { content: "ok" },
            arguments: JSON.stringify({ agent_id: "helper", brief: "hi" }),
          },
        },
      },
    },
    pending,
  );
  expect(late.length).toBeGreaterThanOrEqual(2);
  const use = late[0] as { message: { content: Array<{ name: string; input: Record<string, unknown> }> } };
  expect(use.message.content[0]?.name).toBe("mcp__agentup__delegate_to_agent");
  expect(use.message.content[0]?.input.agent_id).toBe("helper");
});

it("assistant/message 投影成鸭子文本", () => {
  const out = projectDshNotification(
    {
      method: "session.event",
      params: {
        event: {
          type: "assistant/message",
          data: { message: { content: [{ type: "text", text: "hello" }] } },
        },
      },
    },
    new Map(),
  );
  expect(out).toEqual([
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
      },
    },
  ]);
});

it("AskUser tool/result：厂商 JSON 改写成 User answered", () => {
  const pending = new Map();
  const announced = projectDshNotification(
    {
      method: "session.event",
      params: {
        event: {
          type: "tool/call",
          data: {
            callId: "ask-1",
            name: "ask_user_question",
            arguments: {
              questions: [
                {
                  id: "rerun",
                  question: "要重跑吗？",
                  options: [{ label: "重跑一遍，我要看流程" }],
                },
              ],
            },
          },
        },
      },
    },
    pending,
  );
  expect(announced.length).toBe(1);
  const result = projectDshNotification(
    {
      method: "session.event",
      params: {
        event: {
          type: "tool/result",
          data: {
            callId: "ask-1",
            message: JSON.stringify({
              answers: [{ id: "rerun", selected: ["重跑一遍，我要看流程"] }],
            }),
          },
        },
      },
    },
    pending,
  );
  const text = JSON.stringify(result);
  expect(text).toContain("User answered:");
  expect(text).toContain("重跑一遍，我要看流程");
  expect(text).not.toMatch(/\\"answers\\"/);
});

it("rewriteAskUserResultText 直转厂商 JSON", () => {
  const text = rewriteAskUserResultText(
    {
      questions: [
        {
          id: "rerun",
          question: "要重跑吗？",
          options: [{ label: "重跑" }],
        },
      ],
    },
    JSON.stringify({ answers: [{ id: "rerun", selected: ["重跑"] }] }),
  );
  expect(text).toBe("User answered:\n1. 要重跑吗？ → 重跑");
});

it("assistant/message 丢弃 reasoning，只投影可见 text", () => {
  const out = projectDshNotification(
    {
      method: "session.event",
      params: {
        event: {
          type: "assistant/message",
          data: {
            message: {
              content: [
                { type: "reasoning", text: "secret chain of thought" },
                { type: "text", text: "你好" },
              ],
            },
          },
        },
      },
    },
    new Map(),
  );
  expect(out).toEqual([
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "你好" }],
      },
    },
  ]);
});
