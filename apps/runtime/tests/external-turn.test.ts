import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";

import {
  appendExternalTurnToSession,
  externalPromptFromSession,
  mergeTrailWithFinalText,
  runExternalTurn,
} from "../src/session/turn/external-turn.js";
import type { DelegationStartedEvent } from "../src/session/delegation/progress.js";
import type { ApprovalRequest } from "../src/session/hitl/approval/types.js";
import { projectHistory } from "../src/session/history/history.js";
import type { AskUserRequest, AskUserResolved } from "../src/session/tools/ask-user.js";

/** 收集 chunk 类型，断言"投影出了什么"而不纠结具体字段。 */
function types(chunks: UIMessageChunk[]): string[] {
  return chunks.map((chunk) => chunk.type);
}

async function* source(
  messages: unknown[],
  opts: { onEnd?: () => void } = {},
): AsyncGenerator<unknown> {
  for (const message of messages) yield message;
  opts.onEnd?.();
}

const APPROVAL = {
  id: "ap-1",
  userId: "guest",
  agentId: "a1",
  toolCallId: "t1",
  toolName: "Bash",
  args: { command: "ls" },
} as unknown as ApprovalRequest;

it("流式正文与工具过程都投影成 UI chunk，末尾正常收束", async () => {
  const chunks: UIMessageChunk[] = [];
  const outcome = await runExternalTurn({
    source: source([
      { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你好" } } },
      {
        type: "stream_event",
        event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "Bash", input: {} } },
      },
      {
        type: "stream_event",
        event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' } },
      },
      { type: "stream_event", event: { type: "content_block_stop", index: 1 } },
      { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "a.txt" }] } },
      { type: "result", subtype: "success", result: "你好", session_id: "s1" },
    ]),
    write: (batch) => chunks.push(...batch),
    errorPolicy: "prompt",
  });

  expect(outcome.visibleText).toBe("你好");
  expect(outcome.aborted).toBe(false);
  expect(types(chunks)).toEqual([
    "start",
    "start-step",
    "text-start",
    "text-delta",
    "text-end",
    "tool-input-available",
    "tool-output-available",
    "message-metadata",
    "finish-step",
    "finish",
  ]);
});

it("回合结束把最终文本与工具摘要回写进会话（否则下一轮重放断档）", async () => {
  const back: Array<{ text: string; toolDigest: string[]; aborted: boolean }> = [];
  await runExternalTurn({
    source: source([
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", id: "t9", name: "Read", input: { path: "a.md" } }] },
      },
      { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t9", content: "内容" }] } },
      { type: "result", subtype: "success", result: "读完了" },
    ]),
    write: () => undefined,
    errorPolicy: "prompt",
    writeBack: (input) => back.push(input),
  });

  expect(back).toHaveLength(1);
  expect(back[0]!.text).toBe("读完了");
  expect(back[0]!.toolDigest).toEqual([`Read({"path":"a.md"})`]);
  expect(back[0]!.aborted).toBe(false);
});

it("只有 result、没有流式事件时，最终文本仍然渲染出来", async () => {
  const chunks: UIMessageChunk[] = [];
  await runExternalTurn({
    source: source([{ type: "result", subtype: "success", result: "直接给结果" }]),
    write: (batch) => chunks.push(...batch),
    errorPolicy: "prompt",
  });

  expect(types(chunks).filter((type) => type === "text-delta")).toHaveLength(1);
  expect(types(chunks)).toContain("finish");
});

it("审批请求投影成审批卡（HITL 订阅与 Pi 回合同形）", async () => {
  const chunks: UIMessageChunk[] = [];
  await runExternalTurn({
    source: source([{ type: "result", subtype: "success", result: "ok" }]),
    write: (batch) => chunks.push(...batch),
    errorPolicy: "prompt",
    hitl: {
      accept: () => true,
      approvals: {
        subscribe: (listener) => {
          void Promise.resolve().then(() => listener(APPROVAL));
          return () => undefined;
        },
      },
    },
  });

  await Promise.resolve();
  expect(types(chunks)).toContain("data-agentup-approval");
  expect(types(chunks)).toContain("tool-input-available");
});

it("SDK AskUserQuestion 投影成提问卡，而不是工具审批卡", async () => {
  const chunks: UIMessageChunk[] = [];
  const request = {
    id: "ask-1",
    userId: "guest",
    agentId: "a1",
    toolCallId: "tool-ask-1",
    questions: [
      {
        question: "交给谁？",
        options: [{ title: "Weaty" }],
        allowMultiple: false,
      },
    ],
  } as AskUserRequest;
  await runExternalTurn({
    source: source([{ type: "result", subtype: "success", result: "ok" }]),
    write: (batch) => chunks.push(...batch),
    errorPolicy: "prompt",
    hitl: {
      accept: () => true,
      askUser: {
        subscribe: (listener) => {
          void Promise.resolve().then(() => listener(request));
          return () => undefined;
        },
      },
    },
  });

  await Promise.resolve();
  expect(types(chunks)).toContain("data-agentup-ask-user");
  expect(types(chunks)).not.toContain("data-agentup-approval");
});

it("AskUser 答完后投影同形 tool result，不被收尾占位盖掉", async () => {
  const chunks: UIMessageChunk[] = [];
  const request = {
    id: "ask-2",
    userId: "guest",
    agentId: "a1",
    toolCallId: "tool-ask-2",
    questions: [
      {
        question: "查天气这事，谁来办？",
        options: [{ title: "交给 Weaty（气象员）" }],
        allowMultiple: false,
      },
    ],
  } as AskUserRequest;
  const resolved: AskUserResolved = {
    request,
    answer: {
      kind: "answers",
      items: [{ kind: "selection", selections: ["交给 Weaty（气象员）"] }],
    },
    resultText: "User answered:\n1. 查天气这事，谁来办？ → 交给 Weaty（气象员）",
  };
  let resolveListeners: Array<(event: AskUserResolved) => void> = [];

  await runExternalTurn({
    source: (async function* () {
      yield {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-ask-2",
              name: "AskUserQuestion",
              input: { questions: request.questions },
            },
          ],
        },
      };
      // 模拟用户答题：broker.emitResolved
      await Promise.resolve();
      for (const listener of resolveListeners) listener(resolved);
      yield { type: "result", subtype: "success", result: "深圳有雨" };
    })(),
    write: (batch) => chunks.push(...batch),
    errorPolicy: "prompt",
    hitl: {
      accept: () => true,
      askUser: {
        subscribe: () => () => undefined,
        subscribeResolved: (listener) => {
          resolveListeners = [...resolveListeners, listener];
          return () => {
            resolveListeners = resolveListeners.filter((item) => item !== listener);
          };
        },
      },
    },
  });

  const outputs = chunks.filter((chunk) => chunk.type === "tool-output-available") as Array<{
    type: string;
    toolCallId: string;
    output: unknown;
  }>;
  const askOut = outputs.find((chunk) => chunk.toolCallId === "tool-ask-2");
  expect(askOut?.output).toBe(resolved.resultText);
  expect(types(chunks)).not.toContain("tool-output-error");
});

describe("回写会话", () => {
  it("直连 SDK 的 prompt 包含历史、隐藏上下文和本轮用户消息", () => {
    const prompt = externalPromptFromSession(
      {
        sessionManager: {
          getBranch: () => [
            {
              type: "message",
              message: { role: "user", content: "上一问", timestamp: 1 },
            },
            {
              type: "message",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "上一答" }],
                timestamp: 2,
              },
            },
            {
              type: "custom_message",
              content: "# Relevant recruited agents\n- Weaty",
              timestamp: 3,
            },
          ],
        },
      },
      "深圳天气",
    );

    expect(prompt).toContain("上一问");
    expect(prompt).toContain("上一答");
    expect(prompt).toContain("Relevant recruited agents");
    expect(prompt).toContain("深圳天气");
  });

  it("群执掌续写后：SDK 重拼 prompt 带上多轮历史（勿只剩最新一句）", () => {
    const prompt = externalPromptFromSession(
      {
        sessionManager: {
          getBranch: () => [
            {
              type: "message",
              message: {
                role: "user",
                content: [{ type: "text", text: "用户：写一个寻路算法，用 python，dfs" }],
                timestamp: 1,
              },
            },
            {
              type: "message",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "Q1 选网格？推荐 A" }],
                timestamp: 2,
              },
            },
          ],
        },
      },
      "按推荐",
    );
    expect(prompt).toContain("寻路算法");
    expect(prompt).toContain("Q1");
    expect(prompt).toContain("按推荐");
  });

  it("结构化落盘：toolCall/toolResult + 总结正文，digest 不进可见文本", () => {
    const appended: unknown[] = [];
    const customs: unknown[] = [];
    const hidden: unknown[] = [];
    appendExternalTurnToSession(
      {
        sessionManager: {
          appendMessage: (message) => appended.push(message),
          appendCustomEntry: (type, data) => customs.push({ type, data }),
          appendCustomMessageEntry: (type, content, display) =>
            hidden.push({ type, content, display }),
        },
      },
      {
        userText: "查下天气",
        text: "晴",
        toolDigest: ['mcp__agentup__delegate_to_agent({"agent_id":"w"})'],
        replyModel: {
          templateId: "cursor",
          modelId: "gpt-5",
          vendorId: "cursor",
          modelLabel: "GPT-5",
        },
        trail: [
          {
            kind: "tool",
            id: "d1",
            name: "mcp__agentup__delegate_to_agent",
            args: { agent_id: "w", brief: "查" },
            result: "Delegation completed.\nresult:\n晴",
            isError: false,
            done: true,
          },
          { kind: "text", text: "晴" },
        ],
      },
    );

    expect(appended[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "查下天气" }],
    });
    expect(appended[1]).toMatchObject({
      role: "assistant",
      provider: "cursor",
      model: "gpt-5",
      content: [
        {
          type: "toolCall",
          id: "d1",
          name: "mcp__agentup__delegate_to_agent",
        },
      ],
    });
    expect(appended[2]).toMatchObject({ role: "toolResult", toolCallId: "d1" });
    expect(appended[3]).toMatchObject({
      role: "assistant",
      provider: "cursor",
      model: "gpt-5",
      content: [{ type: "text", text: "晴" }],
    });
    expect(JSON.stringify(appended[3])).not.toContain("本轮用过的工具");
    expect(customs).toEqual([
      {
        type: "agentup-reply-model",
        data: {
          templateId: "cursor",
          modelId: "gpt-5",
          vendorId: "cursor",
          modelLabel: "GPT-5",
        },
      },
      { type: "agentup-summary", data: { textPartIndex: 0 } },
    ]);
    expect(hidden).toEqual([
      {
        type: "agentup.external_tool_digest",
        content: expect.stringContaining("本轮用过的工具"),
        display: false,
      },
    ]);
  });

  it("没有 sessionManager 就静默跳过", () => {
    expect(() => appendExternalTurnToSession(undefined, { text: "x", toolDigest: [] })).not.toThrow();
  });

  it("结构化 writeBack 经 projectHistory 出现 tool parts + summary 指向正文", () => {
    const appended: unknown[] = [];
    appendExternalTurnToSession(
      { sessionManager: { appendMessage: (message) => appended.push(message) } },
      {
        text: "总结句",
        toolDigest: [],
        trail: [
          {
            kind: "tool",
            id: "c1",
            name: "mcp__agentup__agent_search",
            args: { query: "天气" },
            result: "Weaty",
            done: true,
          },
          { kind: "text", text: "总结句" },
        ],
      },
    );
    const history = projectHistory(appended);
    expect(history).toHaveLength(1);
    expect(history[0]?.role).toBe("assistant");
    expect(history[0]?.parts).toMatchObject([
      {
        type: "dynamic-tool",
        toolCallId: "c1",
        toolName: "mcp__agentup__agent_search",
        state: "output-available",
      },
      { type: "text", text: "总结句" },
    ]);
  });

  it("mergeTrailWithFinalText：仅工具时补最终正文", () => {
    expect(
      mergeTrailWithFinalText(
        [{ kind: "tool", id: "t", name: "Bash", args: {}, done: true, result: "ok" }],
        "完事",
      ),
    ).toMatchObject([
      { kind: "tool", id: "t" },
      { kind: "text", text: "完事" },
    ]);
  });

  it("delegationStarted 接入后写出 data-agentup-delegation-started", async () => {
    const chunks: UIMessageChunk[] = [];
    let listener: ((event: DelegationStartedEvent) => void) | undefined;
    const started: DelegationStartedEvent = {
      userId: "guest",
      fromAgentId: "a1",
      taskId: "task-1",
      toolCallId: "d1",
      toAgentId: "weather",
      toAgentName: "Weaty",
      brief: "查",
      wait: false,
    };
    const outcome = await runExternalTurn({
      source: (async function* () {
        yield {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "d1",
                name: "DeferExecuteTool",
                input: {
                  toolName: "mcp__agentup__delegate_to_agent",
                  params: { agent_id: "weather", brief: "查" },
                },
              },
            ],
          },
        };
        listener?.(started);
        yield {
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "d1", content: "ok" }],
          },
        };
        yield { type: "result", subtype: "success", result: "委托完成" };
      })(),
      write: (batch) => chunks.push(...batch),
      errorPolicy: "prompt",
      delegationStarted: {
        subscribe: (fn) => {
          listener = fn;
          return () => {
            listener = undefined;
          };
        },
        accept: () => true,
      },
    });
    expect(outcome.visibleText).toContain("委托完成");
    expect(types(chunks)).toContain("data-agentup-delegation-started");
    const toolStart = chunks.find((c) => c.type === "tool-input-available");
    expect(toolStart).toMatchObject({
      type: "tool-input-available",
      toolName: "mcp__agentup__delegate_to_agent",
    });
  });
});

describe("失败与中断", () => {
  it("result 报 error 时写失败文案，不抛", async () => {
    const chunks: UIMessageChunk[] = [];
    const outcome = await runExternalTurn({
      source: source([{ type: "result", subtype: "error_during_execution", errors: ["崩了"] }]),
      write: (batch) => chunks.push(...batch),
      errorPolicy: "prompt",
      locale: "zh",
    });

    expect(outcome.result?.finishReason).toBe("error");
    expect(types(chunks)).toContain("error");
    expect(types(chunks)).toContain("finish");
  });

  it.each([
    {
      name: "成功 result 缺 tool_result",
      tail: [{ type: "result", subtype: "success", result: "完成" }],
    },
    {
      name: "失败 result 缺 tool_result",
      tail: [{ type: "result", subtype: "error_during_execution", errors: ["拒绝执行"] }],
    },
  ])("$name 时也会关闭工具卡", async ({ tail }) => {
    const chunks: UIMessageChunk[] = [];
    await runExternalTurn({
      source: source([
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", id: "dangling", name: "Bash", input: { command: "ls" } }],
          },
        },
        ...tail,
      ]),
      write: (batch) => chunks.push(...batch),
      errorPolicy: "prompt",
    });

    expect(types(chunks)).toContain("tool-input-available");
    // 成功缺 result：占位收尾但不标 error；失败 result：仍标 error
    const failed = tail.some(
      (item) =>
        typeof item === "object" &&
        item &&
        "subtype" in item &&
        item.subtype === "error_during_execution",
    );
    expect(types(chunks)).toContain(failed ? "tool-output-error" : "tool-output-available");
    expect(types(chunks).at(-1)).toBe("finish");
  });

  it("用户中断：不当成功，回写带 aborted 标记", async () => {
    const controller = new AbortController();
    const back: Array<{ aborted: boolean }> = [];
    const outcome = await runExternalTurn({
      source: (async function* () {
        yield { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "半句" } } };
        controller.abort();
        yield { type: "result", subtype: "success", result: "全句" };
      })(),
      signal: controller.signal,
      write: () => undefined,
      errorPolicy: "prompt",
      outcome: {},
      writeBack: (input) => back.push(input),
    });

    expect(outcome.aborted).toBe(true);
    expect(back[0]?.aborted).toBe(true);
  });

  it("迭代抛错：prompt 策略吞掉并写流，propagate 原样抛", async () => {
    const boom = (async function* () {
      throw new Error("SDK 掉线");
      // eslint-disable-next-line no-unreachable
      yield {};
    })();
    const chunks: UIMessageChunk[] = [];
    await runExternalTurn({
      source: boom,
      write: (batch) => chunks.push(...batch),
      errorPolicy: "prompt",
      locale: "zh",
    });
    expect(types(chunks)).toContain("error");

    const boomAgain = (async function* () {
      throw new Error("SDK 掉线");
      // eslint-disable-next-line no-unreachable
      yield {};
    })();
    await expect(
      runExternalTurn({ source: boomAgain, write: () => undefined, errorPolicy: "propagate" }),
    ).rejects.toThrow("SDK 掉线");
  });

  it("外部流空闲超时会中断执行并正常收束 UI", async () => {
    const chunks: UIMessageChunk[] = [];
    let stopped = false;
    await runExternalTurn({
      source: (async function* () {
        await new Promise((resolve) => setTimeout(resolve, 100));
        yield { type: "result", subtype: "success", result: "太晚了" };
      })(),
      timeoutMs: 5,
      onTimeout: () => {
        stopped = true;
      },
      write: (batch) => chunks.push(...batch),
      errorPolicy: "prompt",
      locale: "zh",
    });

    expect(stopped).toBe(true);
    expect(types(chunks)).toContain("finish");
    expect(JSON.stringify(chunks)).toContain("超时");
  });

  it("流持续有消息时按空闲窗口续命，不因墙钟超过 timeoutMs 而掐断", async () => {
    const chunks: UIMessageChunk[] = [];
    let stopped = false;
    const outcome = await runExternalTurn({
      source: (async function* () {
        // 三段间隔各 ~25ms，墙钟合计 > timeoutMs(40)，但每次收包后应续命
        yield {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "先" },
          },
        };
        await new Promise((resolve) => setTimeout(resolve, 25));
        yield {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "后" },
          },
        };
        await new Promise((resolve) => setTimeout(resolve, 25));
        yield { type: "result", subtype: "success", result: "做完了", num_turns: 3 };
      })(),
      timeoutMs: 40,
      onTimeout: () => {
        stopped = true;
      },
      write: (batch) => chunks.push(...batch),
      errorPolicy: "prompt",
      locale: "zh",
    });

    expect(stopped).toBe(false);
    expect(outcome.aborted).toBe(false);
    expect(outcome.visibleText).toContain("先");
    expect(outcome.visibleText).toContain("后");
    expect(outcome.result?.finishReason).toBe("completed");
    expect(JSON.stringify(chunks)).not.toContain("超时");
  });

  it("用户停止时即使厂商流挂死也能立刻收束（群聊不再卡进行中）", async () => {
    const chunks: UIMessageChunk[] = [];
    const controller = new AbortController();
    let interrupted = 0;
    let releaseHang: (() => void) | undefined;

    // 模拟 OpenCode SSE：出半句后永远等不到 session.idle
    const source = (async function* () {
      yield {
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "半句" } },
      };
      await new Promise<void>((resolve) => {
        releaseHang = resolve;
      });
      yield { type: "result", subtype: "success", result: "不该到这" };
    })();

    const turn = runExternalTurn({
      source,
      signal: controller.signal,
      onTimeout: () => {
        interrupted += 1;
        releaseHang?.();
      },
      write: (batch) => chunks.push(...batch),
      errorPolicy: "prompt",
      locale: "zh",
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    const outcome = await Promise.race([
      turn,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("停止后回合仍未收束")), 500),
      ),
    ]);

    expect(outcome.aborted).toBe(true);
    expect(interrupted).toBeGreaterThan(0);
    expect(types(chunks)).toContain("finish");
    expect(JSON.stringify(chunks)).toContain("已停止");
  });

  it("工具启动后超时仍会输出工具终态", async () => {
    const chunks: UIMessageChunk[] = [];
    await runExternalTurn({
      source: (async function* () {
        yield {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", id: "slow", name: "Bash", input: {} }],
          },
        };
        await new Promise((resolve) => setTimeout(resolve, 100));
      })(),
      timeoutMs: 5,
      write: (batch) => chunks.push(...batch),
      errorPolicy: "prompt",
    });

    expect(types(chunks)).toContain("tool-output-error");
    expect(types(chunks).at(-1)).toBe("finish");
  });
});
