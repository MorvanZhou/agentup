import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { getProviderTemplate } from "../src/config/provider-templates.js";
import { createExternalTranslator } from "../src/session/external/events.js";
import {
  clearCopilotGithubToken,
  ensureCopilotHome,
  hasCopilotToken,
  readCopilotGithubToken,
  writeCopilotGithubToken,
  copilotHomeDir,
} from "../src/session/external/sdk/adapters/copilot/home.js";
import {
  accountLabelOf,
  COPILOT_TOKEN_PAGE,
  formatCopilotModelsError,
  isAuthenticated,
  isPlaceholderModelCatalog,
  normalizeModels,
} from "../src/session/external/sdk/adapters/copilot/lifecycle.js";
import { resolveEsmEntryUrl, runtimePlatformOf } from "../src/session/external/sdk/adapters/copilot/load.js";
import {
  COPILOT_CONTEXT_HEADER,
  copilotAskUserRequestToQuestions,
  copilotSessionConfigOf,
  toCopilotHttpMcp,
} from "../src/session/external/sdk/adapters/copilot/options.js";
import {
  mirrorCopilotSession,
  projectCopilotEvent,
  stringifyCopilotToolResult,
  unwrapCopilotMcpTool,
} from "../src/session/external/sdk/adapters/copilot/stream.js";
import { getExternalDriver } from "../src/session/external/sdk/registry.js";
import { formatAskUserResultText } from "../src/session/tools/ask-user.js";

it("登录 token 页钉死在 personal-access-tokens", () => {
  expect(COPILOT_TOKEN_PAGE).toBe("https://github.com/settings/personal-access-tokens");
});

it("formatCopilotModelsError 收窄网络 / DNS 失败文案", () => {
  expect(
    formatCopilotModelsError(
      new Error(
        'Request models.list failed: {"kind":"network","message":"dns error ENOTFOUND api.individual.githubcopilot.com"}',
      ),
    ),
  ).toContain("DNS");
  expect(
    formatCopilotModelsError(
      new Error(
        "Request models.list failed: connection closed via error api.individual.githubcopilot.com",
      ),
    ),
  ).toContain("网络或代理");
});

it("模板 copilot-sdk 声明 driverId=copilot 与 .github/skills", () => {
  const template = getProviderTemplate("copilot-sdk");
  expect(template?.access).toBe("agent-sdk");
  expect(template?.agentSdk?.driverId).toBe("copilot");
  expect(template?.agentSdk?.package).toBe("@github/copilot-sdk");
  expect(template?.agentSdk?.skillsProjectRel).toBe(".github/skills");
  expect(template?.agentSdk?.spec).toContain("@github/copilot-sdk@1.0.28");
  expect(template?.agentSdk?.apiKeyPaste).toBe("github-pat");
  expect(template?.defaultModelId).toBe("auto");
});

it("registry 能取到 copilot driver，systemPromptMode=append", () => {
  const driver = getExternalDriver("copilot");
  expect(driver.capabilities.driverId).toBe("copilot");
  expect(driver.capabilities.systemPromptMode).toBe("append");
  expect(driver.capabilities.askUserToolNames).toEqual(["ask_user", "AskUserQuestion"]);
});

it("home 只落在 agentSdkDir 隔离目录，token 可读写", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-copilot-home-"));
  const home = ensureCopilotHome(root, "copilot-sdk");
  expect(home).toBe(copilotHomeDir(root, "copilot-sdk"));
  expect(home).toContain(path.join("agent-sdks", "copilot-sdk", "copilot-home"));
  expect(hasCopilotToken(root, "copilot-sdk")).toBe(false);

  writeCopilotGithubToken(root, "copilot-sdk", "gho_test_token", "octocat");
  expect(hasCopilotToken(root, "copilot-sdk")).toBe(true);
  expect(readCopilotGithubToken(root, "copilot-sdk")).toBe("gho_test_token");

  clearCopilotGithubToken(root, "copilot-sdk");
  expect(hasCopilotToken(root, "copilot-sdk")).toBe(false);
});

it("resolveEsmEntryUrl 直接读安装目录 package.json", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-copilot-esm-"));
  const pkgDir = path.join(root, "node_modules", "@github", "copilot-sdk");
  fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: "@github/copilot-sdk",
      exports: {
        ".": { import: "./dist/index.js", require: "./dist/cjs/index.js" },
      },
    }),
  );
  fs.writeFileSync(path.join(pkgDir, "dist", "index.js"), "export {};\n");
  const url = resolveEsmEntryUrl(root, "@github/copilot-sdk");
  expect(url.startsWith("file://")).toBe(true);
  expect(url.endsWith("/dist/index.js")).toBe(true);
});

it("runtimePlatformOf 映射本机平台包后缀", () => {
  expect(runtimePlatformOf("darwin", "arm64")).toBe("darwin-arm64");
  expect(runtimePlatformOf("darwin", "x64")).toBe("darwin-x64");
  expect(runtimePlatformOf("win32", "x64")).toBe("win32-x64");
  expect(runtimePlatformOf("linux", "x64", false)).toBe("linux-x64");
  expect(runtimePlatformOf("linux", "x64", true)).toBe("linuxmusl-x64");
  expect(runtimePlatformOf("freebsd", "x64")).toBeNull();
});

it("session 信任 + systemMessage append + MCP http headers", () => {
  const input = {
    prompt: "hi",
    cwd: "/tmp/proj",
    additionalDirs: ["/tmp/extra"],
    systemAppend: "## Environment\ndarwin",
    abortController: new AbortController(),
    userDataRoot: "/tmp",
    templateId: "copilot-sdk",
    mcpServer: {
      type: "http",
      url: "http://127.0.0.1:9/mcp",
      headers: { Authorization: "Bearer t" },
    },
  };
  const session = copilotSessionConfigOf(input, {
    approveAll: () => ({ kind: "approve-once" }),
  });
  expect(session.model).toBe("auto");
  expect(session.workingDirectory).toBe("/tmp/proj");
  expect(session.trustWorkingDirectory).toBe("session");
  expect(session.infiniteSessions).toEqual({ enabled: false });
  expect(session.enableSessionStore).toBe(false);
  expect(session.streaming).toBe(true);
  const systemMessage = session.systemMessage as { content: string };
  expect(systemMessage.content.startsWith(COPILOT_CONTEXT_HEADER)).toBe(true);
  expect(systemMessage.content).toContain("## Environment");
  const servers = session.mcpServers as Record<string, Record<string, unknown>>;
  expect(servers.agentup).toEqual({
    type: "http",
    url: "http://127.0.0.1:9/mcp",
    headers: { Authorization: "Bearer t" },
    tools: ["*"],
  });
});

it("toCopilotHttpMcp 保留 Host headers", () => {
  expect(
    toCopilotHttpMcp({
      type: "http",
      url: "http://127.0.0.1/mcp",
      headers: { Authorization: "Bearer x" },
    }),
  ).toEqual({
    type: "http",
    url: "http://127.0.0.1/mcp",
    headers: { Authorization: "Bearer x" },
    tools: ["*"],
  });
});

it("AskUser 入参归一 + formatAskUserResultText", () => {
  const questions = copilotAskUserRequestToQuestions({
    question: "谁来做？",
    choices: ["Weaty", "小A"],
  });
  expect(questions).toEqual([
    {
      question: "谁来做？",
      options: [{ title: "Weaty" }, { title: "小A" }],
      allowMultiple: false,
    },
  ]);
  const text = formatAskUserResultText(questions!, {
    kind: "answers",
    items: [{ kind: "selection", selections: ["Weaty"] }],
  });
  expect(text).toContain("谁来做？");
  expect(text).toContain("Weaty");
});

it("isAuthenticated / accountLabelOf 鸭子解析", () => {
  expect(isAuthenticated({ authenticated: true, login: "octocat" })).toBe(true);
  expect(isAuthenticated({ status: "logged-in" })).toBe(true);
  expect(isAuthenticated({ status: "anonymous" })).toBe(false);
  expect(accountLabelOf({ user: { login: "octocat" } })).toBe("octocat");
});

it("normalizeModels 读 id/label，可选 credits 与 contextWindow", () => {
  expect(
    normalizeModels([
      {
        id: "gpt-5",
        label: "GPT-5",
        billing: { creditsMultiplier: 1.5 },
        capabilities: {
          limits: { max_context_window_tokens: 400_000, max_output_tokens: 128_000 },
        },
      },
      { id: "auto", label: "Auto" },
      { id: "gpt-5", label: "dup" },
    ]),
  ).toEqual([
    {
      id: "gpt-5",
      name: "GPT-5",
      credits: 1.5,
      contextWindow: 400_000,
      maxTokens: 128_000,
    },
    { id: "auto", name: "Auto" },
  ]);
});

it("仅 auto/default 视为占位目录，应继续拉活列表", () => {
  expect(isPlaceholderModelCatalog([])).toBe(true);
  expect(isPlaceholderModelCatalog([{ id: "auto", name: "Copilot Auto" }])).toBe(true);
  expect(
    isPlaceholderModelCatalog([
      { id: "auto", name: "Copilot Auto" },
      { id: "gpt-5", name: "GPT-5" },
    ]),
  ).toBe(false);
});

it("unwrapCopilotMcpTool 解成 mcp__agentup__* / ask_user", () => {
  expect(
    unwrapCopilotMcpTool("mcp:agentup-delegate_to_agent", {
      agent_id: "a1",
      task: "go",
    }),
  ).toEqual({
    name: "mcp__agentup__delegate_to_agent",
    args: { agent_id: "a1", task: "go" },
  });
  expect(unwrapCopilotMcpTool("ask_user", { question: "q?" })).toEqual({
    name: "ask_user",
    args: { question: "q?" },
  });
});

it("空参 tool.execution_start 延迟 announce，complete 再补", () => {
  const pending = new Map();
  expect(
    projectCopilotEvent(
      {
        type: "tool.execution_start",
        data: { toolCallId: "t1", toolName: "mcp:agentup-delegate_to_agent", toolArgs: {} },
      },
      pending,
    ),
  ).toEqual([]);
  expect(pending.get("t1")?.announced).toBe(false);

  const completed = projectCopilotEvent(
    {
      type: "tool.execution_complete",
      data: {
        toolCallId: "t1",
        toolName: "mcp:agentup-delegate_to_agent",
        toolArgs: { agent_id: "a1" },
        result: { content: [{ type: "text", text: "ok" }] },
      },
    },
    pending,
  );
  expect(completed).toHaveLength(2);
  const use = completed[0] as {
    message: { content: Array<{ type: string; name: string; input: Record<string, unknown> }> };
  };
  expect(use.message.content[0]?.name).toBe("mcp__agentup__delegate_to_agent");
  expect(use.message.content[0]?.input).toEqual({ agent_id: "a1" });
});

it("stringifyCopilotToolResult 抽 MCP content 正文", () => {
  expect(
    stringifyCopilotToolResult({ content: [{ type: "text", text: "hello" }] }),
  ).toBe("hello");
});

it("assistant.message_delta 进 projector 不炸", () => {
  const pending = new Map();
  const messages = projectCopilotEvent(
    { type: "assistant.message_delta", data: { deltaContent: "hi" } },
    pending,
  );
  const translator = createExternalTranslator();
  for (const message of messages) {
    expect(() => translator.push(message as never)).not.toThrow();
  }
  expect(translator.text).toContain("hi");
});

it("mirrorCopilotSession 只订 wildcard 或 typed 其一，避免 delta 双倍口吃", async () => {
  const typed = new Map<string, Set<(event: unknown) => void>>();
  const wild = new Set<(event: unknown) => void>();
  const session = {
    sessionId: "s1",
    on(eventTypeOrHandler: string | ((event: unknown) => void), handler?: (event: unknown) => void) {
      if (typeof eventTypeOrHandler === "string" && handler) {
        if (!typed.has(eventTypeOrHandler)) typed.set(eventTypeOrHandler, new Set());
        typed.get(eventTypeOrHandler)!.add(handler);
        return;
      }
      if (typeof eventTypeOrHandler === "function") wild.add(eventTypeOrHandler);
    },
  };
  const gen = mirrorCopilotSession(session, Promise.resolve());
  await gen.next(); // system/init
  expect(wild.size).toBe(1);
  expect(typed.size).toBe(0);
});

it("mirrorCopilotSession 在无 wildcard 时回落 typed", async () => {
  const typed = new Map<string, Set<(event: unknown) => void>>();
  const session = {
    sessionId: "s1",
    on(eventTypeOrHandler: string | ((event: unknown) => void), handler?: (event: unknown) => void) {
      if (typeof eventTypeOrHandler === "string" && handler) {
        if (!typed.has(eventTypeOrHandler)) typed.set(eventTypeOrHandler, new Set());
        typed.get(eventTypeOrHandler)!.add(handler);
        return;
      }
      throw new Error("wildcard unsupported");
    },
  };
  const gen = mirrorCopilotSession(session, Promise.resolve());
  await gen.next();
  expect(typed.size).toBeGreaterThan(0);
  expect(typed.get("assistant.reasoning_delta")?.size).toBe(1);
});
