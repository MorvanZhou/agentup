import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { getExternalDriver } from "../src/session/external/sdk/registry.js";
import { resolveEsmEntryUrl } from "../src/session/external/sdk/adapters/cursor/load.js";
import {
  composePromptPrefix,
  cursorAskUserArgsToQuestions,
  cursorCreateOptionsOf,
  CURSOR_ASK_USER_INPUT_SCHEMA,
  CURSOR_CONTEXT_HEADER,
} from "../src/session/external/sdk/adapters/cursor/options.js";
import {
  CURSOR_RIPGREP_ENV,
  ensureCursorRipgrepPath,
  resolveBundledCursorRipgrepPath,
} from "../src/session/external/sdk/adapters/cursor/ripgrep.js";
import {
  mirrorCursorRun,
  resultMessageOf,
  stringifyCursorToolResult,
  unwrapCursorMcpTool,
} from "../src/session/external/sdk/adapters/cursor/stream.js";
import { formatAskUserResultText } from "../src/session/tools/ask-user.js";
import { resultFromSdkMessage } from "../src/session/external/sdk/host/result.js";
import { createExternalTranslator } from "../src/session/external/events.js";
import { getProviderTemplate } from "../src/config/provider-templates.js";

/** Electron 入口不在 agent-sdk 安装树旁，SDK 靠 CURSOR_RIPGREP_PATH 找自带 rg。 */
function fixtureCursorSdkInstallWithRg(): { root: string; rgPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-cursor-rg-"));
  const platformPkg = `@cursor/sdk-${process.platform}-${process.arch}`;
  const binName = process.platform === "win32" ? "rg.exe" : "rg";
  const binDir = path.join(root, "node_modules", ...platformPkg.split("/"), "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const rgPath = path.join(binDir, binName);
  fs.writeFileSync(rgPath, "#!/bin/sh\necho mock-rg\n");
  fs.chmodSync(rgPath, 0o755);
  return { root, rgPath };
}

it("resolveBundledCursorRipgrepPath 读安装目录平台包 bin/rg", () => {
  const { root, rgPath } = fixtureCursorSdkInstallWithRg();
  expect(resolveBundledCursorRipgrepPath(root)).toBe(rgPath);
  expect(resolveBundledCursorRipgrepPath(path.join(root, "missing"))).toBeUndefined();
});

it("ensureCursorRipgrepPath：未配置时写入 CURSOR_RIPGREP_PATH；已有可用路径不覆盖", () => {
  const { root, rgPath } = fixtureCursorSdkInstallWithRg();
  const previous = process.env[CURSOR_RIPGREP_ENV];
  try {
    delete process.env[CURSOR_RIPGREP_ENV];
    expect(ensureCursorRipgrepPath(root)).toBe(rgPath);
    expect(process.env[CURSOR_RIPGREP_ENV]).toBe(rgPath);

    const other = path.join(root, "other-rg");
    fs.writeFileSync(other, "#!/bin/sh\n");
    fs.chmodSync(other, 0o755);
    process.env[CURSOR_RIPGREP_ENV] = other;
    expect(ensureCursorRipgrepPath(root)).toBe(other);
    expect(process.env[CURSOR_RIPGREP_ENV]).toBe(other);

    // 环境变量指向不存在文件 → 回落到自带 rg
    process.env[CURSOR_RIPGREP_ENV] = path.join(root, "gone-rg");
    expect(ensureCursorRipgrepPath(root)).toBe(rgPath);
    expect(process.env[CURSOR_RIPGREP_ENV]).toBe(rgPath);
  } finally {
    if (previous === undefined) delete process.env[CURSOR_RIPGREP_ENV];
    else process.env[CURSOR_RIPGREP_ENV] = previous;
  }
});

it("resolveEsmEntryUrl 直接读安装目录 package.json，不走 exports 子路径", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-cursor-esm-"));
  const pkgDir = path.join(root, "node_modules", "@cursor", "sdk");
  fs.mkdirSync(path.join(pkgDir, "dist", "esm"), { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: "@cursor/sdk",
      exports: {
        ".": { import: "./dist/esm/index.js", require: "./dist/cjs/index.js" },
      },
    }),
  );
  fs.writeFileSync(path.join(pkgDir, "dist", "esm", "index.js"), "export {};\n");
  const url = resolveEsmEntryUrl(root, "@cursor/sdk");
  expect(url.startsWith("file://")).toBe(true);
  expect(url.endsWith("/dist/esm/index.js")).toBe(true);
});

it("模板 cursor-sdk 声明 driverId=cursor 与 .cursor/skills", () => {
  const template = getProviderTemplate("cursor-sdk");
  expect(template?.access).toBe("agent-sdk");
  expect(template?.agentSdk?.driverId).toBe("cursor");
  expect(template?.agentSdk?.package).toBe("@cursor/sdk");
  expect(template?.agentSdk?.skillsProjectRel).toBe(".cursor/skills");
});

it("registry 能取到 cursor driver，且 systemPromptMode=prompt_prefix", () => {
  const driver = getExternalDriver("cursor");
  expect(driver.capabilities.driverId).toBe("cursor");
  expect(driver.capabilities.systemPromptMode).toBe("prompt_prefix");
  expect(driver.capabilities.askUserToolNames).toEqual(["ask_user", "agentup_ask_user"]);
});

it("不传 systemPrompt；Host context 进 user prompt 前缀", () => {
  const options = cursorCreateOptionsOf(
    {
      prompt: "hi",
      cwd: "/tmp",
      additionalDirs: [],
      systemAppend: "## Environment\ndarwin",
      abortController: new AbortController(),
      userDataRoot: "/tmp",
      templateId: "cursor-sdk",
    },
    { apiKey: "k", localStore: {} },
  );
  expect(options).not.toHaveProperty("systemPrompt");
  const text = composePromptPrefix("## Environment\ndarwin", "hi");
  expect(text.startsWith(CURSOR_CONTEXT_HEADER)).toBe(true);
  expect(text).toContain("## Environment");
  expect(text).toContain("hi");
});

it("askUser 时 customTools 用 inputSchema（不是 parameters）", () => {
  const options = cursorCreateOptionsOf(
    {
      prompt: "hi",
      cwd: "/tmp",
      additionalDirs: [],
      systemAppend: "",
      abortController: new AbortController(),
      userDataRoot: "/tmp",
      templateId: "cursor-sdk",
      askUser: { request: async () => ({ kind: "cancelled" }) },
    },
    { apiKey: "k", localStore: {} },
  );
  const local = options.local as { customTools?: Record<string, Record<string, unknown>> };
  const tool = local.customTools?.agentup_ask_user;
  expect(tool).toBeTruthy();
  expect(tool).toHaveProperty("inputSchema", CURSOR_ASK_USER_INPUT_SCHEMA);
  expect(tool).not.toHaveProperty("parameters");
});

it("Cursor ask_user 入参归一成 Host AskUserQuestion[]", () => {
  // 标准 AskUserQuestion 形
  expect(
    cursorAskUserArgsToQuestions({
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

  // 会话里失败过的扁平形：question + options[{id,label}]
  expect(
    cursorAskUserArgsToQuestions({
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

  // message + choices:string[]
  expect(
    cursorAskUserArgsToQuestions({
      message: "谁来做？",
      choices: ["交给 Weaty", "自己查"],
    }),
  ).toEqual([
    {
      question: "谁来做？",
      options: [{ title: "交给 Weaty" }, { title: "自己查" }],
      allowMultiple: false,
    },
  ]);

  expect(cursorAskUserArgsToQuestions({ prompt: "只有题没有选项" })).toBeNull();
});

it("Cursor mcp 壳解包：ask_user + mcp__agentup__*（对齐 CodeBuddy UI）", () => {
  expect(
    unwrapCursorMcpTool("mcp", {
      providerIdentifier: "custom-user-tools",
      toolName: "agentup_ask_user",
      args: {
        questions: [{ question: "谁来做？", options: [{ label: "Weaty" }] }],
      },
    }),
  ).toEqual({
    name: "ask_user",
    args: {
      questions: [{ question: "谁来做？", options: [{ label: "Weaty" }] }],
    },
  });
  expect(
    unwrapCursorMcpTool("mcp", {
      providerIdentifier: "agentup",
      toolName: "agent_search",
      args: { query: "天气" },
    }),
  ).toEqual({
    name: "mcp__agentup__agent_search",
    args: { query: "天气" },
  });
  expect(
    unwrapCursorMcpTool("mcp", {
      providerIdentifier: "agentup",
      toolName: "delegate_to_agent",
      args: { agent_id: "hJsAC7Ph", brief: "查天气" },
    }),
  ).toEqual({
    name: "mcp__agentup__delegate_to_agent",
    args: { agent_id: "hJsAC7Ph", brief: "查天气" },
  });
  // 无 provider 的 mcp 壳保持原样（非 AgentUp）
  expect(unwrapCursorMcpTool("mcp", { toolName: "agent_search", args: { query: "x" } })).toEqual({
    name: "mcp",
    args: { toolName: "agent_search", args: { query: "x" } },
  });
});

it("Cursor 工具结果 MCP 壳抽成纯文本再落盘", () => {
  expect(
    stringifyCursorToolResult({
      status: "success",
      value: {
        content: [
          {
            text: {
              text: "task_id: t1\nstatus: completed\nresult: 晴，约 9°C",
            },
          },
        ],
        isError: false,
      },
    }),
  ).toBe("task_id: t1\nstatus: completed\nresult: 晴，约 9°C");
  expect(stringifyCursorToolResult("已是正文")).toBe("已是正文");
});

it("AskUser 结果文案与 Pi 同形，桌面不会当成已终止", () => {
  const questions = [
    {
      question: "查今天北京天气，你希望谁来做？",
      options: [{ title: "Weaty（气象员）" }, { title: "小A（我自己）" }],
      allowMultiple: false,
    },
  ];
  const text = formatAskUserResultText(questions, {
    kind: "answers",
    items: [{ kind: "selection", selections: ["Weaty（气象员）"] }],
  });
  expect(text.startsWith("User answered:")).toBe(true);
  expect(text).toContain("→ Weaty（气象员）");
  expect(text).not.toMatch(/^查今天北京天气/);
});

it("tool_call 映射成 Host 可投影的 tool_use / tool_result", async () => {
  const agent = { agentId: "ag-1" };
  const run = {
    async *stream() {
      yield {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "先看看" }] },
      };
      yield {
        type: "tool_call",
        call_id: "c1",
        name: "read",
        status: "running",
        args: { path: "README.md" },
      };
      yield {
        type: "tool_call",
        call_id: "c1",
        name: "read",
        status: "completed",
        result: { content: "hi" },
      };
    },
    async wait() {
      return { status: "finished" as const, result: "完成了", usage: { inputTokens: 1, outputTokens: 2 } };
    },
    cancel: async () => undefined,
  };

  const translator = createExternalTranslator();
  const messages: unknown[] = [];
  for await (const message of mirrorCursorRun(agent as never, run as never)) {
    messages.push(message);
    translator.push(message);
  }

  expect(translator.text).toContain("先看看");
  expect(translator.trail.some((item) => item.kind === "tool" && item.name === "read")).toBe(true);
  const done = resultFromSdkMessage(messages.at(-1));
  expect(done?.finishReason).toBe("completed");
  expect(done?.finalText).toBe("完成了");
  expect(done?.usage?.inputTokens).toBe(1);
});

it("resultMessageOf 把 cancelled / error 收成 WorkerResult 形", () => {
  const cancelled = resultFromSdkMessage(
    resultMessageOf({ status: "cancelled" }, "ag"),
  );
  expect(cancelled?.finishReason).toBe("error");
  const failed = resultFromSdkMessage(
    resultMessageOf({ status: "error", error: { message: "boom" } }, "ag"),
  );
  expect(failed?.error?.message).toContain("boom");
});
