import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { getProviderTemplate } from "../src/config/provider-templates.js";
import { getExternalDriver } from "../src/session/external/sdk/registry.js";
import { CodexAskUserIdBridge } from "../src/session/external/sdk/adapters/codex/ask-user-bridge.js";
import { resolveEsmEntryUrl } from "../src/session/external/sdk/adapters/codex/load.js";
import {
  composePromptPrefix,
  codexAskUserArgsToQuestions,
  codexClientOptionsOf,
  codexThreadOptionsOf,
  CODEX_ASK_USER_INPUT_SCHEMA,
  CODEX_CONTEXT_HEADER,
  toCodexHttpMcp,
} from "../src/session/external/sdk/adapters/codex/options.js";
import { parseCodexDebugModels } from "../src/session/external/sdk/adapters/codex/lifecycle.js";
import {
  mirrorCodexEvents,
  stringifyCodexToolResult,
  unwrapCodexMcpTool,
} from "../src/session/external/sdk/adapters/codex/stream.js";
import { formatAskUserResultText } from "../src/session/tools/ask-user.js";
import { resultFromSdkMessage } from "../src/session/external/sdk/host/result.js";
import { createExternalTranslator } from "../src/session/external/events.js";

it("resolveEsmEntryUrl 直接读安装目录 package.json", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-codex-esm-"));
  const pkgDir = path.join(root, "node_modules", "@openai", "codex-sdk");
  fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: "@openai/codex-sdk",
      exports: {
        ".": { import: "./dist/index.js", require: "./dist/index.js" },
      },
    }),
  );
  fs.writeFileSync(path.join(pkgDir, "dist", "index.js"), "export {};\n");
  const url = resolveEsmEntryUrl(root, "@openai/codex-sdk");
  expect(url.startsWith("file://")).toBe(true);
  expect(url.endsWith("/dist/index.js")).toBe(true);
});

it("模板 codex-sdk 声明 driverId=codex 与 .agents/skills", () => {
  const template = getProviderTemplate("codex-sdk");
  expect(template?.access).toBe("agent-sdk");
  expect(template?.agentSdk?.driverId).toBe("codex");
  expect(template?.agentSdk?.package).toBe("@openai/codex-sdk");
  expect(template?.agentSdk?.skillsProjectRel).toBe(".agents/skills");
  expect(template?.agentSdk?.spec).toContain("@openai/codex-sdk@0.166.0");
});

it("registry 能取到 codex driver，且 systemPromptMode=prompt_prefix", () => {
  const driver = getExternalDriver("codex");
  expect(driver.capabilities.driverId).toBe("codex");
  expect(driver.capabilities.systemPromptMode).toBe("prompt_prefix");
  expect(driver.capabilities.askUserToolNames).toEqual(["ask_user", "agentup_ask_user"]);
});

it("Thread 信任模式 + prompt 前缀；MCP 用 http_headers", () => {
  const input = {
    prompt: "hi",
    cwd: "/tmp/proj",
    additionalDirs: ["/tmp/extra"],
    systemAppend: "## Environment\ndarwin",
    abortController: new AbortController(),
    userDataRoot: "/tmp",
    templateId: "codex-sdk",
    mcpServer: {
      type: "http",
      url: "http://127.0.0.1:9/mcp",
      headers: { Authorization: "Bearer t" },
    },
  };
  const thread = codexThreadOptionsOf(input);
  expect(thread.sandboxMode).toBe("danger-full-access");
  expect(thread.approvalPolicy).toBe("never");
  expect(thread.skipGitRepoCheck).toBe(true);
  expect(thread.additionalDirectories).toEqual(["/tmp/extra"]);

  const client = codexClientOptionsOf(input, {
    cliPath: "/fake/codex",
    codexHome: "/tmp/codex-home",
    askUserMcp: {
      url: "http://127.0.0.1:8/mcp",
      headers: { Authorization: "Bearer ask" },
    },
  });
  expect(client.codexPathOverride).toBe("/fake/codex");
  expect(client.env.CODEX_HOME).toBe("/tmp/codex-home");
  const servers = client.config.mcp_servers as Record<string, Record<string, unknown>>;
  expect(servers.agentup).toEqual({
    url: "http://127.0.0.1:9/mcp",
    http_headers: { Authorization: "Bearer t" },
  });
  expect(servers.agentup_ask).toEqual({
    url: "http://127.0.0.1:8/mcp",
    http_headers: { Authorization: "Bearer ask" },
  });

  const text = composePromptPrefix("## Environment\ndarwin", "hi");
  expect(text.startsWith(CODEX_CONTEXT_HEADER)).toBe(true);
  expect(text).toContain("## Environment");
  expect(text).toContain("hi");
});

it("toCodexHttpMcp 把 Host headers 改成 http_headers", () => {
  expect(
    toCodexHttpMcp({
      type: "http",
      url: "http://127.0.0.1/mcp",
      headers: { Authorization: "Bearer x" },
    }),
  ).toEqual({
    url: "http://127.0.0.1/mcp",
    http_headers: { Authorization: "Bearer x" },
  });
});

it("AskUser 入参归一 + schema 字段是 type object", () => {
  expect(CODEX_ASK_USER_INPUT_SCHEMA.type).toBe("object");
  expect(
    codexAskUserArgsToQuestions({
      questions: [
        {
          question: "谁来做？",
          header: "执行人",
          options: [
            { label: "Weaty", description: "气象员" },
            { label: "小A" },
          ],
        },
      ],
    }),
  ).toEqual([
    {
      question: "谁来做？",
      context: "执行人",
      options: [{ title: "Weaty", description: "气象员" }, { title: "小A" }],
      allowMultiple: false,
    },
  ]);
  expect(
    codexAskUserArgsToQuestions({
      question: "谁来做？",
      options: [
        { id: "weaty", label: "交给气象员 Weaty" },
        { id: "self", label: "由你直接查" },
      ],
    }),
  ).toEqual([
    {
      question: "谁来做？",
      options: [{ title: "交给气象员 Weaty" }, { title: "由你直接查" }],
      allowMultiple: false,
    },
  ]);
  expect(codexAskUserArgsToQuestions({ prompt: "只有题没有选项" })).toBeNull();
});

it("Codex MCP 解包：ask_user + mcp__agentup__*", () => {
  expect(
    unwrapCodexMcpTool("agentup_ask", "agentup_ask_user", {
      questions: [{ question: "谁来做？", options: [{ label: "Weaty" }] }],
    }),
  ).toEqual({
    name: "ask_user",
    args: {
      questions: [{ question: "谁来做？", options: [{ label: "Weaty" }] }],
    },
  });
  expect(
    unwrapCodexMcpTool("agentup", "delegate_to_agent", {
      agent_id: "hJsAC7Ph",
      brief: "查天气",
    }),
  ).toEqual({
    name: "mcp__agentup__delegate_to_agent",
    args: { agent_id: "hJsAC7Ph", brief: "查天气" },
  });
  expect(unwrapCodexMcpTool("other", "search", { q: "x" })).toEqual({
    name: "mcp__other__search",
    args: { q: "x" },
  });
});

it("AskUserIdBridge 双向等待都能对齐 id", async () => {
  const bridge = new CodexAskUserIdBridge();
  const pending = bridge.take();
  bridge.publish("call-1");
  await expect(pending).resolves.toBe("call-1");

  bridge.publish("call-2");
  await expect(bridge.take()).resolves.toBe("call-2");
});

it("工具结果 MCP 壳抽成纯文本", () => {
  expect(
    stringifyCodexToolResult({
      content: [{ type: "text", text: "task_id: t1\nresult: ok" }],
    }),
  ).toBe("task_id: t1\nresult: ok");
  expect(stringifyCodexToolResult("已是正文")).toBe("已是正文");
});

it("AskUser 结果文案与 Pi 同形", () => {
  const text = formatAskUserResultText(
    [
      {
        question: "查今天北京天气，你希望谁来做？",
        options: [{ title: "Weaty（气象员）" }, { title: "小A（我自己）" }],
        allowMultiple: false,
      },
    ],
    {
      kind: "answers",
      items: [{ kind: "selection", selections: ["Weaty（气象员）"] }],
    },
  );
  expect(text.startsWith("User answered:")).toBe(true);
  expect(text).toContain("→ Weaty（气象员）");
});

it("runStreamed 事件映射成 Host 可投影的正文与工具卡", async () => {
  async function* events() {
    yield { type: "thread.started", thread_id: "th-1" };
    yield {
      type: "item.completed",
      item: { id: "m1", type: "agent_message", text: "先看看" },
    };
    yield {
      type: "item.started",
      item: {
        id: "c1",
        type: "mcp_tool_call",
        server: "agentup",
        tool: "agent_search",
        arguments: { query: "天气" },
        status: "in_progress",
      },
    };
    yield {
      type: "item.completed",
      item: {
        id: "c1",
        type: "mcp_tool_call",
        server: "agentup",
        tool: "agent_search",
        arguments: { query: "天气" },
        status: "completed",
        result: { content: [{ type: "text", text: "晴" }] },
      },
    };
    yield {
      type: "turn.completed",
      usage: { input_tokens: 1, output_tokens: 2, cached_input_tokens: 0, cache_write_input_tokens: 0, reasoning_output_tokens: 0 },
    };
  }

  const translator = createExternalTranslator();
  const messages: unknown[] = [];
  for await (const message of mirrorCodexEvents(events())) {
    messages.push(message);
    translator.push(message);
  }

  expect(translator.text).toContain("先看看");
  expect(
    translator.trail.some(
      (item) => item.kind === "tool" && item.name === "mcp__agentup__agent_search",
    ),
  ).toBe(true);
  const done = resultFromSdkMessage(messages.at(-1));
  expect(done?.finishReason).toBe("completed");
  expect(done?.usage?.inputTokens).toBe(1);
});

it("parseCodexDebugModels：visibility=list 的 slug 进目录，隐藏项跳过，映射 context_window", () => {
  const models = parseCodexDebugModels(`
noise before
{
  "models": [
    { "slug": "gpt-5.4", "display_name": "GPT-5.4", "visibility": "list", "context_window": 272000 },
    { "slug": "hidden-preview", "visibility": "hidden" },
    { "slug": "gpt-5.4", "visibility": "list" },
    { "id": "legacy-id", "name": "Legacy", "visibility": "list", "max_context_window": 400000 }
  ]
}
trailing
`);
  expect(models).toEqual([
    { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 272_000 },
    { id: "legacy-id", name: "Legacy", contextWindow: 400_000 },
  ]);
});

it("parseCodexDebugModels：无 visibility 时照收；坏 JSON 回空", () => {
  expect(
    parseCodexDebugModels(
      JSON.stringify({
        models: [{ slug: "gpt-6.1-sol", displayName: "GPT-6.1 Sol" }],
      }),
    ),
  ).toEqual([{ id: "gpt-6.1-sol", name: "GPT-6.1 Sol" }]);
  expect(parseCodexDebugModels("not json")).toEqual([]);
});
