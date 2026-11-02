import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Message } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";

import type { Visit } from "../src/package/sync.js";
import { WORKSPACE_POLICY, type WorkspacePolicy } from "../src/session/context/workspace-policy.js";

/** 拦住本地 SDK 的动态 import：测试里换成可控的假 query。 */
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/config/providers/agent-sdk/loader.js", () => ({
  loadAgentSdkModule: async () => ({ query }),
  installedCliPath: () => "/tmp/fake-codebuddy",
  withTimeout: <T>(promise: Promise<T>) => promise,
}));

const { buildSessionPlan } = await import("../src/session/plan.js");
const { openModelRuntime } = await import("../src/session/model/runtime.js");
const { AGENT_SDK_API, queryExternalAgent, resultFromSdkMessage, transcriptToPrompt } = await import(
  "../src/session/model/agent-sdk.js"
);

type SdkMessage = Parameters<typeof resultFromSdkMessage>[0];

function visit(): Visit {
  return {
    root: "/tmp/agentup/users/guest/agents/a1",
    kind: "agent",
    userId: "guest",
    agentId: "a1",
    projectTrust: "granted",
  } as unknown as Visit;
}

function planOf(modelId = "claude-sonnet-5") {
  return buildSessionPlan(visit(), {
    providerId: "codebuddy-sdk",
    templateId: "codebuddy-sdk",
    modelId,
    apiKey: "ollama",
    kind: "agent-sdk",
  });
}

const USER: Message = { role: "user", content: "帮我写个 README", timestamp: 1 } as Message;
const SYSTEM = {
  role: "system",
  content: [{ type: "text", text: "你是 AgentUp 的助手，可用工具：read/write" }],
  timestamp: 0,
} as unknown as Message;
const ASSISTANT = {
  role: "assistant",
  content: [{ type: "text", text: "好的" }],
  api: "openai-completions",
  provider: "openai",
  model: "gpt",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
  stopReason: "stop",
  timestamp: 2,
} as unknown as Message;

function resultMessage(overrides: Record<string, unknown> = {}): SdkMessage {
  return {
    type: "result",
    subtype: "success",
    uuid: "u1",
    session_id: "s1",
    duration_ms: 1234,
    duration_api_ms: 1000,
    is_error: false,
    num_turns: 3,
    result: "写好了",
    total_cost_usd: 0,
    usage: { input_tokens: 22000, output_tokens: 13, cache_read_input_tokens: 2000 },
    permission_denials: [],
    ...overrides,
  } as unknown as SdkMessage;
}

type Stream = AsyncIterable<Record<string, any>>;

/** 打开 runtime 后走 Pi 的公开 streamSimple 通道（model.api === provider.api 才会命中我们）。 */
async function openStream(options: {
  modelId?: string;
  approvals?: { request: ReturnType<typeof vi.fn>; allowsTool?: (toolName: string) => boolean };
  askUser?: { request: ReturnType<typeof vi.fn> };
  visit?: Visit;
  workspacePolicy?: WorkspacePolicy;
  groupId?: string;
  groupWorkspaceRoot?: string;
  mcpTools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; handler: () => Promise<{ text: string }> }>;
} = {}): Promise<{ streamOf: (messages: Message[], opts?: Record<string, unknown>) => Promise<Stream>; }> {
  const current = options.visit ?? visit();
  const { runtime, model } = await openModelRuntime(
    buildSessionPlan(current, {
      providerId: "codebuddy-sdk",
      templateId: "codebuddy-sdk",
      modelId: options.modelId ?? "claude-sonnet-5",
      apiKey: "ollama",
      kind: "agent-sdk",
    }),
    {
      userDataRoot: "/tmp/agentup",
      ...(options.approvals ? { approvals: options.approvals as never } : {}),
      ...(options.askUser ? { askUser: options.askUser as never } : {}),
      userId: "guest",
      agentId: "a1",
      visit: current,
      ...(options.workspacePolicy ? { workspacePolicy: options.workspacePolicy } : {}),
      ...(options.groupId ? { groupId: options.groupId } : {}),
      ...(options.groupWorkspaceRoot ? { groupWorkspaceRoot: options.groupWorkspaceRoot } : {}),
      ...(options.mcpTools ? { mcpTools: options.mcpTools } : {}),
    },
  );
  return {
    streamOf: async (messages, opts = {}) =>
      runtime.streamSimple(model, { messages } as never, opts as never) as unknown as Stream,
  };
}

async function collect(
  streamOf: (messages: Message[], opts?: Record<string, unknown>) => Promise<Stream>,
  messages: Message[],
  options: Record<string, unknown> = {},
): Promise<Array<Record<string, any>>> {
  const events: Array<Record<string, any>> = [];
  for await (const event of await streamOf(messages, options)) events.push(event);
  return events;
}

function setQuery(messages: Array<Record<string, unknown>>): void {
  query.mockReset();
  query.mockImplementation(async function* () {
    for (const message of messages) yield message;
  } as never);
}

/** 取外部 agent 那一轮真实拿到的工具闸（sdkOptions.canUseTool）。 */
function gateOf(): (
  toolName: string,
  input: Record<string, unknown>,
  options: { toolUseID?: string },
) => Promise<{ behavior: string; message?: string }> {
  const passed = query.mock.calls[0]?.[0] as {
    options: {
      canUseTool: (
        toolName: string,
        input: Record<string, unknown>,
        options: { toolUseID?: string },
      ) => Promise<{ behavior: string; message?: string }>;
    };
  };
  return passed.options.canUseTool;
}

/** 外部 CLI 调 deferred 工具的样子：先壳，再带同一个 tool call id 的真工具。 */
const DEFERRED_CALL_ID = "chatcmpl-tool-9df579c9280dbce0";
const DEFERRED_PARAMS = { agent_id: "hJsAC7Ph", brief: "深圳天气", wait: true };

it("折叠 transcript：丢掉 Pi 的系统提示，保留人说的话", () => {
  const prompt = transcriptToPrompt([SYSTEM, ASSISTANT, USER]);
  expect(prompt).toContain("帮我写个 README");
  expect(prompt).toContain("助手：好的");
  // 系统提示里是 AgentUp 自己的工具清单，喂给外部 agent 只会误导它
  expect(prompt).not.toContain("可用工具：read/write");
});

it("折叠 transcript：超长时只留尾部，避免把整段历史都塞给外部 agent", () => {
  const prompt = transcriptToPrompt(
    [{ role: "user", content: `很${"长".repeat(80)}尾巴`, timestamp: 1 } as Message],
    { maxChars: 20 },
  );
  expect(prompt.length).toBeLessThanOrEqual(20);
  expect(prompt).toContain("尾巴");
});

it("ResultMessage 映射：success 取 result，错误型别带走原因", () => {
  const ok = resultFromSdkMessage(resultMessage());
  expect(ok).toMatchObject({ finalText: "写好了", finishReason: "completed", sessionId: "s1" });
  expect(ok?.usage).toMatchObject({ inputTokens: 22000, outputTokens: 13, durationMs: 1234 });

  const failed = resultFromSdkMessage(
    resultMessage({ subtype: "error_during_execution", is_error: true, errors: ["boom"] }),
  );
  expect(failed?.finishReason).toBe("error");
  expect(failed?.error?.message).toContain("boom");

  const turns = resultFromSdkMessage(resultMessage({ subtype: "error_max_turns", is_error: true }));
  expect(turns?.finishReason).toBe("max_tokens");

  // 非 result 消息不参与映射
  expect(resultFromSdkMessage({ type: "system" } as unknown as SdkMessage)).toBeNull();
});

it("本地接入注册成自定义 api 的模型", async () => {
  const { model } = await openModelRuntime(planOf(), { userDataRoot: "/tmp/agentup" });
  expect(model).toMatchObject({ id: "claude-sonnet-5", provider: "codebuddy-sdk" });
  expect(model.api).toBe(AGENT_SDK_API);
});

it("streamSimple 把 ResultMessage.result 变成一条 assistant 回答", async () => {
  setQuery([{ type: "system", subtype: "init" }, resultMessage()]);
  const { streamOf } = await openStream();
  const events = await collect(streamOf, [USER]);
  expect(events.map((item) => item.type)).toEqual([
    "start",
    "text_start",
    "text_delta",
    "text_end",
    "done",
  ]);
  const done = events.at(-1) as { message: { content: Array<{ type: string; text: string }> } };
  expect(done.message.content[0]?.text).toBe("写好了");

  const passed = query.mock.calls[0]?.[0] as { prompt: string; options: Record<string, unknown> };
  expect(passed.prompt).toContain("帮我写个 README");
  expect(passed.options.permissionMode).toBe("bypassPermissions");
  // 否则 SDK 会过滤 stream_event，中间旁白与工具参数流都进不来
  expect(passed.options.includePartialMessages).toBe(true);
  // 「default」是占位模型，不该当成外部 agent 的模型名传下去
  expect(passed.options.model).toBe("claude-sonnet-5");
});

it("接线：人设 / AGENTS.md / 挂载目录进了外部 agent 的 options", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-sdk-ctx-"));
  const cwd = path.join(dir, "cwd");
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".pi", "SYSTEM.md"), "你是 Weaty，气象员。");
  fs.mkdirSync(path.join(dir, ".runtime"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".runtime", "AGENTS.md"), "- 先查实时数据");
  const mounted = path.join(dir, "mounted");
  fs.mkdirSync(mounted, { recursive: true });
  const current = {
    root: dir,
    kind: "agent",
    userId: "guest",
    agentId: "a1",
    projectTrust: "granted",
  } as unknown as Visit;

  setQuery([resultMessage()]);
  const { streamOf } = await openStream({ visit: current });
  await collect(streamOf, [USER]);

  const passed = query.mock.calls[0]?.[0] as { options: Record<string, any> };
  // 不覆盖它的系统提示，只追加（覆盖会把它自己的工具与环境一起抹掉）
  expect(passed.options.systemPrompt).toMatchObject({ append: expect.stringContaining("你是 Weaty") });
  expect(passed.options.systemPrompt.append).toContain("先查实时数据");
  expect(passed.options.systemPrompt.append).toContain("Directories you may read and write");
  // 挂载目录从 visit 的 instance.json 读（这里没写，所以为空）；那一层由
  // tests/external-context.test.ts 覆盖，本例只验证 options 有没有接上。
  expect(passed.options.additionalDirectories).toBeUndefined();
  void mounted;

  fs.rmSync(dir, { recursive: true, force: true });
});

it("接线：没有 visit 时只给 cwd，不编造上下文", async () => {
  setQuery([resultMessage()]);
  const { streamOf } = await openStream();
  await collect(streamOf, [USER]);
  const passed = query.mock.calls[0]?.[0] as { options: Record<string, any> };
  expect(passed.options.additionalDirectories).toBeUndefined();
});

it("群会话只暴露群目录，不回落到成员的私人挂载", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-sdk-group-"));
  const cwd = path.join(dir, "cwd");
  const privateRoot = path.join(dir, "private-project");
  const groupWorkspace = path.join(dir, "group-workspace");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(privateRoot);
  fs.mkdirSync(groupWorkspace);
  fs.writeFileSync(path.join(dir, "instance.json"), JSON.stringify({ project_roots: [privateRoot] }));
  const current = {
    root: dir,
    kind: "agent",
    userId: "guest",
    agentId: "a1",
    projectTrust: "granted",
  } as unknown as Visit;

  setQuery([resultMessage()]);
  const { streamOf } = await openStream({
    visit: current,
    workspacePolicy: WORKSPACE_POLICY["group-holder"],
    groupId: "g1",
    groupWorkspaceRoot: groupWorkspace,
  });
  await collect(streamOf, [USER]);

  const passed = query.mock.calls[0]?.[0] as { options: Record<string, any> };
  expect(passed.options.additionalDirectories).toContain(fs.realpathSync(groupWorkspace));
  expect(passed.options.additionalDirectories).not.toContain(fs.realpathSync(privateRoot));
  fs.rmSync(dir, { recursive: true, force: true });
});

it("占位模型 default 不传给外部 agent", async () => {
  setQuery([resultMessage()]);
  const { streamOf } = await openStream({ modelId: "default" });
  await collect(streamOf, [USER]);
  const passed = query.mock.calls[0]?.[0] as { options: Record<string, unknown> };
  expect(passed.options.model).toBeUndefined();
});

it("分层重放：最近几轮保留原文，更早的压成一行摘要", () => {
  const messages = [
    { role: "user", content: "第一轮很长的问题", timestamp: 1 } as Message,
    { role: "assistant", content: [{ type: "text", text: "第一轮很长的回答" }], timestamp: 2 } as Message,
    { role: "user", content: "最近的问题", timestamp: 3 } as Message,
    { role: "assistant", content: [{ type: "text", text: "最近的回答" }], timestamp: 4 } as Message,
  ];
  const prompt = transcriptToPrompt(messages, { recentTurns: 1, digestChars: 6 });
  expect(prompt).toContain("以下是更早对话的摘要");
  // 最近的这一轮是原文
  expect(prompt).toContain("用户：最近的问题");
  expect(prompt).toContain("助手：最近的回答");
  // 更早的被压短（原文是「用户：第一轮很长的问题」）
  expect(prompt).not.toContain("用户：第一轮很长的问题");
  expect(prompt).toContain("第一轮");
});

it("默认保留最近 6 轮原文，更早的进摘要", () => {
  const messages = Array.from(
    { length: 8 },
    (_, index) =>
      ({
        role: "user",
        content: index < 2 ? `很早很早很早的第${index}轮内容` : `第${index}轮`,
        timestamp: index + 1,
      }) as Message,
  );
  const prompt = transcriptToPrompt(messages, { digestChars: 10 });
  expect(prompt).toContain("以下是更早对话的摘要");
  // 最近 6 轮（索引 2..7）是原文
  expect(prompt).toContain("用户：第7轮");
  // 更早的两条只留摘要，原文不再完整出现
  expect(prompt).not.toContain("很早很早很早的第0轮内容");
});

it("超出预算时先丢更早的摘要，并明说省略了几条（不静默截尾）", () => {
  const messages = [
    { role: "user", content: "旧的一条", timestamp: 1 } as Message,
    { role: "user", content: "旧的两条", timestamp: 2 } as Message,
    { role: "user", content: "最新的问题", timestamp: 3 } as Message,
  ];
  const prompt = transcriptToPrompt(messages, { recentTurns: 1, maxChars: 30 });
  expect(prompt).toContain("已省略更早 2 条消息");
  expect(prompt).toContain("最新的问题");
});

it("每轮都是全新对话：不把会话留在外部 CLI 的目录里", async () => {
  setQuery([resultMessage()]);
  const { streamOf } = await openStream();
  await collect(streamOf, [USER]);
  const passed = query.mock.calls[0]?.[0] as { options: Record<string, unknown> };
  // 上下文由 runtime 拼接（docs/agent_cli §12.5）：不 resume，也不让它落第二份副本
  expect(passed.options.persistSession).toBe(false);
});

it("路 2 入口：queryExternalAgent 只起流，options 与 P1 同一套", async () => {
  setQuery([resultMessage()]);
  const { iterable } = await queryExternalAgent(
    {
      userDataRoot: "/tmp/agentup",
      templateId: "codebuddy-sdk",
      providerId: "codebuddy-sdk",
      modelId: "claude-sonnet-5",
      cwd: "/tmp/agentup/cwd",
    },
    "查天气",
  );
  const seen: unknown[] = [];
  for await (const message of iterable) seen.push(message);

  expect(seen).toHaveLength(1);
  const passed = query.mock.calls[0]?.[0] as { prompt: string; options: Record<string, unknown> };
  expect(passed.prompt).toBe("查天气");
  expect(passed.options.persistSession).toBe(false);
});

it("接线：委托 / 技能工具经本轮 MCP 端点进 sdkOptions，回合结束就收掉", async () => {
  type Entry = { type: string; url: string; headers: Record<string, string> };
  let entry: Entry | undefined;
  let listed: { tools: Array<{ name: string }> } | undefined;
  query.mockReset();
  query.mockImplementation(async function* (params: {
    options: { mcpServers?: Record<string, Entry> };
  }) {
    entry = params.options.mcpServers?.agentup;
    // 回合中就真连一次：只证明端点活着，工具内容由 external-mcp 测试覆盖
    const response = await fetch(entry!.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...entry!.headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    listed = ((await response.json()) as { result: { tools: Array<{ name: string }> } }).result;
    yield resultMessage();
  } as never);

  const { streamOf } = await openStream({
    mcpTools: [
      {
        name: "delegate_to_agent",
        description: "d",
        inputSchema: { type: "object", properties: {} },
        handler: async () => ({ text: "ok" }),
      },
    ],
  });
  await collect(streamOf, [USER]);

  expect(entry?.type).toBe("http");
  expect(entry?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  expect(listed?.tools.map((tool) => tool.name)).toEqual(["delegate_to_agent"]);
  // 端口不留：回合结束后端点应当已经关掉
  await expect(fetch(entry!.url, { method: "POST", body: "{}" })).rejects.toThrow();
});

it("外部 agent 报错时流以 error 收尾，不留半截回答", async () => {
  setQuery([resultMessage({ subtype: "error_during_execution", is_error: true, errors: ["炸了"] })]);
  const { streamOf } = await openStream();
  const events = await collect(streamOf, [USER]);
  expect(events.map((item) => item.type)).toEqual(["start", "error"]);
  const error = events.at(-1) as { error: { errorMessage?: string; stopReason: string } };
  expect(error.error.stopReason).toBe("error");
  expect(error.error.errorMessage).toContain("炸了");
});

it("取消时 abort 掉外部 agent，流以 aborted 收尾", async () => {
  let aborted = false;
  query.mockReset();
  query.mockImplementation(async function* (params: {
    options: { abortController: AbortController };
  }) {
    params.options.abortController.signal.addEventListener("abort", () => {
      aborted = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    // 真实 SDK 被 abort 后是抛 AbortError，不是安静返回
    if (params.options.abortController.signal.aborted) {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
    yield resultMessage();
  } as never);
  const { streamOf } = await openStream();
  const controller = new AbortController();
  const pending = collect(streamOf, [USER], { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  const events = await pending;
  expect(aborted).toBe(true);
  expect(events.at(-1)?.type).toBe("error");
});

it("SDK 信任模式：工具一律放行，不走审批通道", async () => {
  setQuery([resultMessage()]);
  const request = vi.fn(async () => false);
  const { streamOf } = await openStream({ approvals: { request } });
  await collect(streamOf, [USER]);
  const passed = query.mock.calls[0]?.[0] as {
    options: {
      permissionMode: string;
      canUseTool: (name: string, input: unknown, options: unknown) => Promise<any>;
    };
  };
  expect(passed.options.permissionMode).toBe("bypassPermissions");
  const write = await passed.options.canUseTool("Write", { file_path: "a.txt" }, { toolUseID: "t1" });
  const bash = await passed.options.canUseTool("Bash", { command: "rm -rf /" }, { toolUseID: "t2" });
  const deferred = await passed.options.canUseTool(
    "DeferExecuteTool",
    { toolName: "mcp__agentup__delegate_to_agent", params: DEFERRED_PARAMS },
    { toolUseID: DEFERRED_CALL_ID },
  );
  expect(write.behavior).toBe("allow");
  expect(bash.behavior).toBe("allow");
  expect(deferred.behavior).toBe("allow");
  expect(request).not.toHaveBeenCalled();
});

it("AskUserQuestion 走提问通道并把答案回填给 SDK，不进入工具审批", async () => {
  setQuery([resultMessage()]);
  const approval = vi.fn(async () => true);
  const ask = vi.fn(async () => ({
    kind: "answers",
    items: [
      { kind: "selection", selections: ["Weaty"] },
      { kind: "freeform", text: "先给今天" },
    ],
  }));
  const { streamOf } = await openStream({
    approvals: { request: approval },
    askUser: { request: ask },
  });
  await collect(streamOf, [USER]);

  const input = {
    questions: [
      {
        question: "交给谁？",
        header: "专家",
        options: [{ label: "Weaty", description: "气象员" }],
        multiSelect: false,
      },
      {
        question: "还有什么要求？",
        header: "范围",
        options: [{ label: "无", description: "没有额外要求" }],
        multiSelect: false,
      },
    ],
  };
  const verdict = await gateOf()("AskUserQuestion", input, { toolUseID: "ask-1" });

  expect(approval).not.toHaveBeenCalled();
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: "guest",
      agentId: "a1",
      toolCallId: "ask-1",
      questions: [
        expect.objectContaining({
          question: "交给谁？",
          options: [{ title: "Weaty", description: "气象员" }],
          allowMultiple: false,
        }),
        expect.objectContaining({ question: "还有什么要求？" }),
      ],
    }),
    undefined,
  );
  expect(verdict).toEqual({
    behavior: "allow",
    updatedInput: {
      ...input,
      answers: {
        "交给谁？": "Weaty",
        "还有什么要求？": "先给今天",
      },
    },
  });
});

it("AskUserQuestion 之外的工具不请求审批（含 deferred 壳与 MCP）", async () => {
  setQuery([resultMessage()]);
  const request = vi.fn(async () => false);
  const allowsTool = vi.fn(() => false);
  const { streamOf } = await openStream({ approvals: { request, allowsTool } });
  await collect(streamOf, [USER]);

  const canUseTool = gateOf();
  const shell = await canUseTool(
    "DeferExecuteTool",
    { toolName: "mcp__agentup__delegate_to_agent", params: DEFERRED_PARAMS },
    { toolUseID: DEFERRED_CALL_ID },
  );
  const inner = await canUseTool(
    "mcp__agentup__delegate_to_agent",
    DEFERRED_PARAMS,
    { toolUseID: DEFERRED_CALL_ID },
  );
  const bash = await canUseTool("Bash", { command: "date" }, { toolUseID: "bash-1" });
  expect(shell.behavior).toBe("allow");
  expect(inner.behavior).toBe("allow");
  expect(bash.behavior).toBe("allow");
  expect(request).not.toHaveBeenCalled();
  expect(allowsTool).not.toHaveBeenCalled();
});
