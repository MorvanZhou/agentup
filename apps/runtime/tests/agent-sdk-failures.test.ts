import type { Message } from "@earendil-works/pi-ai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";

/** 拦住本地 SDK 的动态 import：换成可控的假 query / 加载失败。 */
const { query, load } = vi.hoisted(() => ({
  query: vi.fn(),
  load: { error: "" as string, hasQuery: true },
}));
vi.mock("../src/config/providers/agent-sdk/loader.js", () => ({
  loadAgentSdkModule: async () => {
    if (load.error) throw new Error(load.error);
    return load.hasQuery ? { query } : {};
  },
  installedCliPath: () => "/tmp/fake-codebuddy",
  withTimeout: <T>(promise: Promise<T>) => promise,
}));

const { buildSessionPlan } = await import("../src/session/plan.js");
const { openModelRuntime } = await import("../src/session/model/runtime.js");
const { setAgentSdkState } = await import("../src/config/provider/index.js");
const { assistantFailureNotice } = await import("../src/session/model/unavailable.js");
const {
  agentSdkFailureNotice,
  classifyAgentSdkFailure,
  isAgentSdkFailure,
  markAgentSdkFailure,
  scrubSecrets,
} = await import("../src/session/model/agent-sdk-failures.js");

type Stream = AsyncIterable<Record<string, any>>;

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentup-agent-sdk-failures-"));
}

function planOf() {
  return buildSessionPlan(
    {
      root: "/tmp/agentup/users/guest/agents/a1",
      kind: "agent",
      userId: "guest",
      agentId: "a1",
      projectTrust: "granted",
    } as never,
    {
      providerId: "codebuddy-sdk",
      templateId: "codebuddy-sdk",
      modelId: "claude-sonnet-5",
      apiKey: "ollama",
      kind: "agent-sdk",
    },
  );
}

const USER = { role: "user", content: "干活", timestamp: 1 } as unknown as Message;

async function openStream(options: {
  userDataRoot: string;
  turnTimeoutMs?: number;
}): Promise<{ streamOf: (messages: Message[]) => Promise<Stream> }> {
  const { runtime, model } = await openModelRuntime(planOf(), {
    userDataRoot: options.userDataRoot,
    ...(options.turnTimeoutMs ? { turnTimeoutMs: options.turnTimeoutMs } : {}),
  });
  return {
    streamOf: async (messages) =>
      runtime.streamSimple(model, { messages } as never, {}) as unknown as Stream,
  };
}

async function errorMessageOf(streamOf: (messages: Message[]) => Promise<Stream>): Promise<string> {
  let last = "";
  for await (const event of await streamOf([USER])) {
    if (event.type === "error") last = String(event.error?.errorMessage ?? "");
    if (event.type === "done") last = "";
  }
  return last;
}

it("分类：原始错误文本 → 可执行的原因码", () => {
  expect(classifyAgentSdkFailure("尚未安装，请先开始接入")).toBe("not_installed");
  expect(classifyAgentSdkFailure("登录态已失效，请重新登录")).toBe("not_logged_in");
  // 真机那条：429 但原因是额度，不是限流
  expect(
    classifyAgentSdkFailure("429 当前无可用Token额度…原因：全局总额度已用尽"),
  ).toBe("quota");
  expect(classifyAgentSdkFailure("429 too many requests")).toBe("rate_limited");
  // 真机遇到过：目录里有这个模型，但当前账号无权使用 → 换模型，重新登录没用
  expect(
    classifyAgentSdkFailure("400 model [claude-sonnet-5] is only available for authorized users"),
  ).toBe("model_unavailable");
  expect(classifyAgentSdkFailure("本地 Agent App 不支持 query()")).toBe("incompatible");
  expect(classifyAgentSdkFailure("something weird")).toBe("unknown");
});

it("分类：本机状态优先于错误文本", () => {
  expect(classifyAgentSdkFailure("boom", "not_installed")).toBe("not_installed");
  expect(classifyAgentSdkFailure("boom", "install_failed")).toBe("not_installed");
  expect(classifyAgentSdkFailure("boom", "not_logged_in")).toBe("not_logged_in");
  expect(classifyAgentSdkFailure("boom", "installed")).toBe("not_logged_in");
  expect(classifyAgentSdkFailure("boom", "ready")).toBe("unknown");
});

it("文案：去标记 + 中英成对，且带下一步动作", () => {
  const marked = markAgentSdkFailure("quota", "全局总额度已用尽");
  expect(isAgentSdkFailure(marked)).toBe(true);
  const zh = agentSdkFailureNotice(marked, "zh");
  const en = agentSdkFailureNotice(marked, "en");
  expect(zh).not.toContain("[agent-sdk:");
  expect(zh).toContain("额度");
  expect(zh).toContain("Workbuddy / CodeBuddy");
  expect(en).not.toContain("[agent-sdk:");
  expect(en).not.toBe(zh);

  // 未知码回落到 unknown，而不是把标记漏出去
  expect(agentSdkFailureNotice("[agent-sdk:nope] x", "zh")).toContain("失败");
  expect(isAgentSdkFailure("普通错误")).toBe(false);
});

it("路由：本地 App 的失败走自己的文案，不被通用「检查 API Key」覆盖", () => {
  const marked = markAgentSdkFailure("not_installed", "尚未安装");
  expect(assistantFailureNotice(marked, "zh")).toBe(agentSdkFailureNotice(marked, "zh"));
  expect(assistantFailureNotice(marked, "zh")).not.toContain("API Key");
});

it("脱敏：错误里的 token / Bearer / 链接参数不进会话与日志", () => {
  const scrubbed = scrubSecrets(
    "failed: Bearer abcdef123456 token=secret-value-1 sk-ant-api03-ABCDEFG https://x/login?token=zzz",
  );
  expect(scrubbed).not.toContain("abcdef123456");
  expect(scrubbed).not.toContain("secret-value-1");
  expect(scrubbed).not.toContain("sk-ant-api03-ABCDEFG");
  expect(scrubbed).not.toContain("token=zzz");
});

it("没装 / 没登录：不等外部 agent，直接给出下一步", async () => {
  const root = tempRoot();
  setAgentSdkState(root, "codebuddy-sdk", "not_installed");
  // 假 query 永不返回：若驱动先去调它就必然超时
  query.mockReset();
  query.mockImplementation(async function* () {
    await new Promise(() => undefined);
    yield {} as never;
  } as never);
  const { streamOf } = await openStream({ userDataRoot: root });
  const message = await errorMessageOf(streamOf);
  expect(query).not.toHaveBeenCalled();
  expect(agentSdkFailureNotice(message, "zh")).toContain("未安装");

  setAgentSdkState(root, "codebuddy-sdk", "not_logged_in");
  const again = await openStream({ userDataRoot: root });
  const login = await errorMessageOf(again.streamOf);
  expect(agentSdkFailureNotice(login, "zh")).toContain("登录");
});

it("加载失败也能分类", async () => {
  const root = tempRoot();
  setAgentSdkState(root, "codebuddy-sdk", "ready");
  load.error = "尚未安装，请先开始接入";
  try {
    const { streamOf } = await openStream({ userDataRoot: root });
    const message = await errorMessageOf(streamOf);
    expect(agentSdkFailureNotice(message, "zh")).toContain("未安装");
  } finally {
    load.error = "";
  }

  load.hasQuery = false;
  try {
    const { streamOf } = await openStream({ userDataRoot: root });
    const message = await errorMessageOf(streamOf);
    expect(agentSdkFailureNotice(message, "zh")).toContain("不支持");
  } finally {
    load.hasQuery = true;
  }
});

it("整回合超时：到点 abort 外部 agent 并给出可执行提示", async () => {
  const root = tempRoot();
  setAgentSdkState(root, "codebuddy-sdk", "ready");
  let aborted = false;
  query.mockReset();
  query.mockImplementation(async function* (params: {
    options: { abortController: AbortController };
  }) {
    params.options.abortController.signal.addEventListener("abort", () => {
      aborted = true;
    });
    await new Promise(() => undefined);
    yield {} as never;
  } as never);
  const { streamOf } = await openStream({ userDataRoot: root, turnTimeoutMs: 20 });
  const message = await errorMessageOf(streamOf);
  expect(aborted).toBe(true);
  expect(agentSdkFailureNotice(message, "zh")).toContain("没有给出结果");
});

it("用户中断不写 errorMessage：交给桌面的「已停止」态", async () => {
  const root = tempRoot();
  setAgentSdkState(root, "codebuddy-sdk", "ready");
  query.mockReset();
  query.mockImplementation(async function* () {
    await new Promise((resolve) => setTimeout(resolve, 200));
    yield { type: "result", subtype: "success", result: "ok" } as never;
  } as never);
  const { runtime, model } = await openModelRuntime(planOf(), { userDataRoot: root });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  const events: Array<Record<string, any>> = [];
  for await (const event of runtime.streamSimple(model, { messages: [USER] } as never, {
    signal: controller.signal,
  } as never) as unknown as Stream) {
    events.push(event);
  }
  expect(events.at(-1)?.type).toBe("error");
  expect(events.at(-1)?.error?.errorMessage ?? "").toBe("");
});
