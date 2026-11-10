import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { getProviderTemplate } from "../src/config/provider-templates.js";
import {
  claudeHomeDir,
  clearClaudeApiKey,
  ensureClaudeHome,
  hasClaudeApiKey,
  readClaudeApiKey,
  writeClaudeApiKey,
} from "../src/session/external/sdk/adapters/claude-code/home.js";
import {
  CLAUDE_API_KEY_PAGE,
  CLAUDE_MODELS_UNAVAILABLE,
} from "../src/session/external/sdk/adapters/claude-code/lifecycle.js";
import {
  anthropicModelsListUrl,
  normalizeAnthropicModels,
} from "../src/session/external/sdk/adapters/claude-code/models-api.js";
import { claudeOptionsOf } from "../src/session/external/sdk/adapters/claude-code/options.js";
import { getExternalDriver } from "../src/session/external/sdk/registry.js";

it("API Key 页钉死在 console.anthropic.com/settings/keys", () => {
  expect(CLAUDE_API_KEY_PAGE).toBe("https://console.anthropic.com/settings/keys");
});

it("模板 claude-agent-sdk 外显 Claude Code，driverId=claude-code，无假占位模型", () => {
  const template = getProviderTemplate("claude-agent-sdk");
  expect(template?.access).toBe("agent-sdk");
  expect(template?.vendorId).toBe("anthropic");
  expect(template?.label).toBe("Claude Code");
  expect(template?.vendorLabel).toBe("Claude Code");
  expect(template?.agentSdk?.driverId).toBe("claude-code");
  expect(template?.agentSdk?.package).toBe("@anthropic-ai/claude-agent-sdk");
  expect(template?.agentSdk?.skillsProjectRel).toBe(".claude/skills");
  expect(template?.agentSdk?.spec).toContain("@anthropic-ai/claude-agent-sdk@0.3.318");
  expect(template?.agentSdk?.apiKeyPaste).toBe("anthropic");
  expect(template?.models).toEqual([]);
  expect(template?.defaultModelId).toBeUndefined();
});

it("registry 能取到 claude-code driver，systemPromptMode=append", () => {
  const driver = getExternalDriver("claude-code");
  expect(driver.capabilities.driverId).toBe("claude-code");
  expect(driver.capabilities.systemPromptMode).toBe("append");
  expect(driver.capabilities.askUserToolNames).toEqual(["AskUserQuestion"]);
});

it("home 只落在 agentSdkDir 隔离目录，Key 可读写", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-claude-home-"));
  const home = ensureClaudeHome(root, "claude-agent-sdk");
  expect(home).toBe(claudeHomeDir(root, "claude-agent-sdk"));
  expect(home).toContain(path.join("agent-sdks", "claude-agent-sdk", "claude-home"));
  expect(hasClaudeApiKey(root, "claude-agent-sdk")).toBe(false);

  writeClaudeApiKey(root, "claude-agent-sdk", "sk-ant-test-key", "Claude");
  expect(hasClaudeApiKey(root, "claude-agent-sdk")).toBe(true);
  expect(readClaudeApiKey(root, "claude-agent-sdk")).toBe("sk-ant-test-key");

  clearClaudeApiKey(root, "claude-agent-sdk");
  expect(hasClaudeApiKey(root, "claude-agent-sdk")).toBe(false);
});

it("拉不到模型时文案钉死：提示重新拉取或手动配置（禁止 FALLBACK 假目录）", () => {
  expect(CLAUDE_MODELS_UNAVAILABLE).toBe(
    "暂时无法获取可用模型列表，请重新拉取，或手动配置",
  );
});

it("Models API URL 对齐可成功的 curl：无 lifecycle 过滤参数", () => {
  const url = anthropicModelsListUrl();
  expect(url).toBe("https://api.anthropic.com/v1/models?limit=100");
  expect(url).not.toContain("lifecycle");
  expect(anthropicModelsListUrl("claude-opus-4-6")).toContain("after_id=claude-opus-4-6");
});

it("normalizeAnthropicModels：展示名与 id 分开，跳过 retired，映射窗口", () => {
  const models = normalizeAnthropicModels([
    {
      id: "claude-opus-4-6",
      display_name: "Claude Opus 4.6",
      lifecycle: "active",
      max_input_tokens: 1_000_000,
      max_tokens: 128_000,
    },
    {
      id: "claude-sonnet-4-5",
      display_name: "Claude Sonnet 4.5",
      lifecycle: "deprecated",
    },
    {
      id: "claude-old",
      display_name: "Old",
      lifecycle: "retired",
    },
  ]);
  expect(models).toEqual([
    {
      id: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      contextWindow: 1_000_000,
      maxTokens: 128_000,
    },
    { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
  ]);
});

it("options：preset append + bypass + persistSession false + 隔离 env", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-claude-opts-"));
  writeClaudeApiKey(root, "claude-agent-sdk", "sk-ant-test");
  const options = claudeOptionsOf({
    prompt: "hi",
    cwd: "/tmp/proj",
    additionalDirs: ["/tmp/extra"],
    systemAppend: "## Environment\ndarwin",
    modelId: "claude-sonnet-4-5",
    abortController: new AbortController(),
    userDataRoot: root,
    templateId: "claude-agent-sdk",
    mcpServer: {
      type: "http",
      url: "http://127.0.0.1:9/mcp",
      headers: { Authorization: "Bearer t" },
    },
  });

  expect(options.permissionMode).toBe("bypassPermissions");
  expect(options.allowDangerouslySkipPermissions).toBe(true);
  expect(options.persistSession).toBe(false);
  expect(options.includePartialMessages).toBe(true);
  expect(options.settingSources).toEqual(["project"]);
  expect(options.model).toBe("claude-sonnet-4-5");
  expect(options.additionalDirectories).toEqual(["/tmp/extra"]);
  expect(options.systemPrompt).toEqual({
    type: "preset",
    preset: "claude_code",
    append: "## Environment\ndarwin",
  });
  expect(options.mcpServers).toEqual({
    agentup: {
      type: "http",
      url: "http://127.0.0.1:9/mcp",
      headers: { Authorization: "Bearer t" },
    },
  });

  const env = options.env as Record<string, string>;
  expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
  expect(env.CLAUDE_CONFIG_DIR).toBe(claudeHomeDir(root, "claude-agent-sdk"));
  expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
});

it("modelId=default 时不传 model 字段", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-claude-default-"));
  writeClaudeApiKey(root, "claude-agent-sdk", "sk-ant-test");
  const options = claudeOptionsOf({
    prompt: "hi",
    cwd: "/tmp/proj",
    additionalDirs: [],
    systemAppend: "",
    modelId: "default",
    abortController: new AbortController(),
    userDataRoot: root,
    templateId: "claude-agent-sdk",
  });
  expect(options.model).toBeUndefined();
});

it("AskUser 对齐：真实 toolUseID 透传；updatedInput.answers；其它工具恒 allow（ui-status §2.1）", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-claude-ask-"));
  writeClaudeApiKey(root, "claude-agent-sdk", "sk-ant-test");
  const seen: Array<{ toolCallId: string; questions: unknown[] }> = [];
  const options = claudeOptionsOf({
    prompt: "hi",
    cwd: "/tmp/proj",
    additionalDirs: [],
    systemAppend: "## Environment",
    modelId: "claude-sonnet-4-5",
    abortController: new AbortController(),
    userDataRoot: root,
    templateId: "claude-agent-sdk",
    userId: "u1",
    agentId: "a1",
    askUser: {
      request: async (request) => {
        seen.push({
          toolCallId: request.toolCallId,
          questions: request.questions,
        });
        return {
          kind: "answered",
          items: [{ kind: "selected", selections: ["蓝色"] }],
        };
      },
    },
  });

  const canUseTool = options.canUseTool as (
    name: string,
    input: Record<string, unknown>,
    opts: { toolUseID?: string },
  ) => Promise<
    | { behavior: "allow"; updatedInput?: Record<string, unknown> }
    | { behavior: "deny"; message: string }
  >;

  await expect(canUseTool("Bash", { command: "ls" }, {})).resolves.toEqual({
    behavior: "allow",
  });

  const ask = await canUseTool(
    "AskUserQuestion",
    {
      questions: [
        {
          question: "喜欢什么颜色？",
          header: "偏好",
          options: [{ label: "蓝色", description: "冷色" }],
          multiSelect: false,
        },
      ],
    },
    { toolUseID: "toolu_claude_real_1" },
  );
  expect(seen).toEqual([
    {
      toolCallId: "toolu_claude_real_1",
      questions: [
        {
          question: "喜欢什么颜色？",
          context: "偏好",
          options: [{ title: "蓝色", description: "冷色" }],
          allowMultiple: false,
        },
      ],
    },
  ]);
  expect(ask).toEqual({
    behavior: "allow",
    updatedInput: {
      questions: [
        {
          question: "喜欢什么颜色？",
          header: "偏好",
          options: [{ label: "蓝色", description: "冷色" }],
          multiSelect: false,
        },
      ],
      answers: { "喜欢什么颜色？": "蓝色" },
    },
  });
});

it("AskUser：无通道或坏参数 → deny；Host 文案以 User answered 开头（同构 CodeBuddy）", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-claude-ask-deny-"));
  writeClaudeApiKey(root, "claude-agent-sdk", "sk-ant-test");
  const options = claudeOptionsOf({
    prompt: "hi",
    cwd: "/tmp/proj",
    additionalDirs: [],
    systemAppend: "",
    abortController: new AbortController(),
    userDataRoot: root,
    templateId: "claude-agent-sdk",
  });
  const canUseTool = options.canUseTool as (
    name: string,
    input: Record<string, unknown>,
    opts: { toolUseID?: string },
  ) => Promise<{ behavior: string; message?: string }>;
  await expect(
    canUseTool("AskUserQuestion", { questions: [{ question: "q", options: [{ label: "a" }] }] }, {}),
  ).resolves.toMatchObject({ behavior: "deny" });

  // Host subscribeResolved 落盘靠 formatAskUserResultText；钉死桌面可摘要前缀
  const { formatAskUserResultText } = await import("../src/session/tools/ask-user.js");
  const text = formatAskUserResultText(
    [{ question: "喜欢什么颜色？", options: [{ title: "蓝色" }] }],
    { kind: "answered", items: [{ kind: "selected", selections: ["蓝色"] }] },
  );
  expect(text.startsWith("User answered:")).toBe(true);
  expect(text).toContain("蓝色");
});

it("MCP：mcpServers.agentup 为 http + headers（流内应是 mcp__agentup__*）", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-claude-mcp-"));
  writeClaudeApiKey(root, "claude-agent-sdk", "sk-ant-test");
  const options = claudeOptionsOf({
    prompt: "hi",
    cwd: "/tmp/proj",
    additionalDirs: [],
    systemAppend: "",
    abortController: new AbortController(),
    userDataRoot: root,
    templateId: "claude-agent-sdk",
    mcpServer: {
      type: "http",
      url: "http://127.0.0.1:18789/mcp",
      headers: { Authorization: "Bearer tok" },
    },
  });
  expect(options.mcpServers).toEqual({
    agentup: {
      type: "http",
      url: "http://127.0.0.1:18789/mcp",
      headers: { Authorization: "Bearer tok" },
    },
  });
  expect(getExternalDriver("claude-code").capabilities.askUserToolNames).toEqual([
    "AskUserQuestion",
  ]);
  expect(getExternalDriver("claude-code").capabilities.systemPromptMode).toBe("append");
});

it("MCP：平台 Playwright 与 agentup 一并写入 mcpServers（勿只挂 agentup）", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-claude-pw-"));
  writeClaudeApiKey(root, "claude-agent-sdk", "sk-ant-test");
  const playwright = {
    command: "npx",
    args: ["-y", "@playwright/mcp@0.0.46", "--headless"],
    env: { PLAYWRIGHT_BROWSERS_PATH: "/tmp/browsers" },
    exposure: "deferred" as const,
  };
  const options = claudeOptionsOf({
    prompt: "hi",
    cwd: "/tmp/proj",
    additionalDirs: [],
    systemAppend: "",
    abortController: new AbortController(),
    userDataRoot: root,
    templateId: "claude-agent-sdk",
    mcpServer: {
      type: "http",
      url: "http://127.0.0.1:18789/mcp",
      headers: { Authorization: "Bearer tok" },
    },
    platformMcpServers: { playwright },
  });
  expect(options.mcpServers).toEqual({
    agentup: {
      type: "http",
      url: "http://127.0.0.1:18789/mcp",
      headers: { Authorization: "Bearer tok" },
    },
    playwright,
  });
});
