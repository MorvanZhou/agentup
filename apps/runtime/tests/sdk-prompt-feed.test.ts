/**
 * SDK 可喂视图拼装（agent-context-compaction.md §5）：
 * 无滑动 6 轮 digest；有压缩边界则 summary+尾巴；超限才回退丢旧行。
 */
import { describe, expect, it } from "vitest";
import type { Message } from "@earendil-works/pi-ai";

import {
  appendContextCompaction,
  maybeCompactApiBranch,
  maybeCompactBranch,
} from "../src/session/external/sdk/host/compact.js";
import {
  CONTEXT_COMPACTION_CUSTOM_TYPE,
  CONTEXT_COMPACTION_PREFIX,
  MAX_PROMPT_CHARS,
  estimateFeedChars,
  feedMessagesFromBranch,
  transcriptToPrompt,
} from "../src/session/external/sdk/host/prompt.js";
import {
  externalPromptFromSession,
  runExternalSessionTurn,
} from "../src/session/turn/external-turn.js";

const user = (text: string, timestamp: number): Message =>
  ({ role: "user", content: text, timestamp }) as Message;

const assistant = (text: string, timestamp: number): Message =>
  ({
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp,
  }) as Message;

describe("transcriptToPrompt 主路径", () => {
  it("无边界：保留全部原文行，不把更早轮压成短 digest", () => {
    const messages = [
      user("第一轮很长的问题内容不要被截成摘要", 1),
      assistant("第一轮很长的回答内容也不要压短", 2),
      user("最近的问题", 3),
      assistant("最近的回答", 4),
    ];
    const prompt = transcriptToPrompt(messages);
    expect(prompt).toContain("用户：第一轮很长的问题内容不要被截成摘要");
    expect(prompt).toContain("助手：第一轮很长的回答内容也不要压短");
    expect(prompt).toContain("用户：最近的问题");
    expect(prompt).not.toContain("以下是更早对话的摘要");
  });

  it("丢掉 Pi system，避免工具清单误导外部 agent", () => {
    const prompt = transcriptToPrompt([
      { role: "system", content: "可用工具：read/write", timestamp: 0 } as Message,
      user("帮我写个 README", 1),
      assistant("好的", 2),
    ]);
    expect(prompt).toContain("帮我写个 README");
    expect(prompt).not.toContain("可用工具：read/write");
  });

  it("超限回退：丢最早整行并标明省略，不改写中间为 digest", () => {
    const messages = [
      user("旧的一条aaaa", 1),
      user("旧的两条bbbb", 2),
      user("最新的问题", 3),
    ];
    const prompt = transcriptToPrompt(messages, { maxChars: 28 });
    expect(prompt).toMatch(/已省略更早 \d+ 条消息/);
    expect(prompt).toContain("最新的问题");
    expect(prompt).not.toContain("以下是更早对话的摘要");
    expect(prompt.length).toBeLessThanOrEqual(28);
  });

  it("单条仍超限时硬切尾部", () => {
    const prompt = transcriptToPrompt([user(`很${"长".repeat(80)}尾巴`, 1)], { maxChars: 20 });
    expect(prompt.length).toBeLessThanOrEqual(20);
    expect(prompt).toContain("尾巴");
  });

  it("默认上限为 MAX_PROMPT_CHARS", () => {
    expect(MAX_PROMPT_CHARS).toBe(60_000);
  });
});

describe("压缩边界可喂视图", () => {
  it("有边界：只拼 summary + 边界之后原文 + 本轮", () => {
    const feed = feedMessagesFromBranch(
      [
        {
          type: "message",
          message: user("很早以前的问题", 1),
        },
        {
          type: "message",
          message: assistant("很早以前的回答", 2),
        },
        {
          type: "custom_message",
          customType: CONTEXT_COMPACTION_CUSTOM_TYPE,
          content: "早先讨论了寻路，已选定 DFS。",
          timestamp: 3,
        },
        {
          type: "message",
          message: user("按推荐继续", 4),
        },
        {
          type: "message",
          message: assistant("好，开始写代码", 5),
        },
      ],
      "补单测",
    );
    const prompt = transcriptToPrompt(feed);
    expect(prompt).toContain(`${CONTEXT_COMPACTION_PREFIX}早先讨论了寻路，已选定 DFS。`);
    expect(prompt).toContain("按推荐继续");
    expect(prompt).toContain("好，开始写代码");
    expect(prompt).toContain("补单测");
    expect(prompt).not.toContain("很早以前的问题");
    expect(prompt).not.toContain("很早以前的回答");
  });

  it("无边界：branch 全量进可喂视图", () => {
    const feed = feedMessagesFromBranch(
      [
        { type: "message", message: user("上一问", 1) },
        {
          type: "message",
          message: assistant("上一答", 2),
        },
        {
          type: "custom_message",
          content: "# Relevant recruited agents\n- Weaty",
          timestamp: 3,
        },
      ],
      "深圳天气",
    );
    const prompt = transcriptToPrompt(feed);
    expect(prompt).toContain("上一问");
    expect(prompt).toContain("上一答");
    expect(prompt).toContain("Relevant recruited agents");
    expect(prompt).toContain("深圳天气");
  });

  it("externalPromptFromSession 走同一套边界语义", () => {
    const prompt = externalPromptFromSession(
      {
        sessionManager: {
          getBranch: () => [
            { type: "message", message: user("应被压缩掉", 1) },
            {
              type: "custom_message",
              customType: CONTEXT_COMPACTION_CUSTOM_TYPE,
              content: "已压缩：任务是写 README",
              timestamp: 2,
            },
            { type: "message", message: user("加一节安装", 3) },
          ],
        },
      },
      "再加故障排查",
    );
    expect(prompt).toContain("已压缩：任务是写 README");
    expect(prompt).toContain("加一节安装");
    expect(prompt).toContain("再加故障排查");
    expect(prompt).not.toContain("应被压缩掉");
  });

  it("appendContextCompaction 写入隐藏边界后拼装只见摘要", () => {
    const hidden: Array<{ type: string; content: string; display: boolean }> = [];
    expect(
      appendContextCompaction(
        {
          appendCustomMessageEntry: (type, content, display) => {
            hidden.push({ type, content, display });
          },
        },
        "摘要：做完登录页",
      ),
    ).toBe(true);
    expect(hidden).toEqual([
      {
        type: CONTEXT_COMPACTION_CUSTOM_TYPE,
        content: "摘要：做完登录页",
        display: false,
      },
    ]);
    const prompt = transcriptToPrompt(
      feedMessagesFromBranch(
        [
          { type: "message", message: user("旧话", 1) },
          {
            type: "custom_message",
            customType: CONTEXT_COMPACTION_CUSTOM_TYPE,
            content: "摘要：做完登录页",
            timestamp: 2,
          },
        ],
        "下一步",
      ),
    );
    expect(prompt).toContain(`${CONTEXT_COMPACTION_PREFIX}摘要：做完登录页`);
    expect(prompt).not.toContain("旧话");
  });

  it("Pi compaction entry：摘要 + firstKept 之后原文，丢弃更早", () => {
    const prompt = transcriptToPrompt(
      feedMessagesFromBranch(
        [
          { id: "old", type: "message", message: user("旧话应丢", 1) },
          { id: "kept", type: "message", message: user("保留尾巴", 2) },
          {
            id: "c1",
            type: "compaction",
            summary: "摘要：登录页完成",
            firstKeptEntryId: "kept",
          },
          { id: "new", type: "message", message: user("下一句", 3) },
        ],
        "本轮",
      ),
    );
    expect(prompt).toContain(`${CONTEXT_COMPACTION_PREFIX}摘要：登录页完成`);
    expect(prompt).toContain("保留尾巴");
    expect(prompt).toContain("下一句");
    expect(prompt).toContain("本轮");
    expect(prompt).not.toContain("旧话应丢");
  });

  it("maybeCompactApiBranch：超预算时 appendCompaction(firstKept)", async () => {
    const long = "字".repeat(200);
    const entries = [
      { id: "e1", type: "message", message: user(long, 1) },
      { id: "e2", type: "message", message: assistant(long, 2) },
      { id: "e3", type: "message", message: user("最近一句", 3) },
    ];
    const calls: Array<{ summary: string; firstKept: string | null; tokens: number }> = [];
    const ok = await maybeCompactApiBranch({
      entries,
      userText: "继续",
      budgetChars: 50,
      keepRecentTokens: 5,
      summarize: async () => "API压缩要点",
      sink: {
        appendCompaction(summary, firstKeptEntryId, tokensBefore) {
          calls.push({
            summary,
            firstKept: firstKeptEntryId,
            tokens: tokensBefore,
          });
          return "comp-1";
        },
      },
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.summary).toBe("API压缩要点");
    expect(calls[0]!.firstKept).toBeTruthy();
    expect(["e1", "e2", "e3"]).toContain(calls[0]!.firstKept);
  });

  it("maybeCompactApiBranch：中等会话不因 keep≈窗15% 整段保留而跳过", async () => {
    // 回归：旧逻辑 keepRecentTokens≈19200 时 findCutPoint 会 firstKept=0 → 静默不落盘
    const chunk = "字".repeat(800);
    const entries = Array.from({ length: 12 }, (_, i) => ({
      id: `e${i}`,
      type: "message" as const,
      message: (i % 2 === 0 ? user(chunk, i + 1) : assistant(chunk, i + 1)),
    }));
    const calls: string[] = [];
    const ok = await maybeCompactApiBranch({
      entries,
      userText: "继续",
      budgetChars: 2000,
      contextWindowTokens: 128_000,
      summarize: async () => "应落盘的摘要",
      sink: {
        appendCompaction(summary, firstKeptEntryId) {
          calls.push(`${summary}|${firstKeptEntryId}`);
          return "comp-reg";
        },
      },
    });
    expect(ok).toBe(true);
    expect(calls[0]).toMatch(/^应落盘的摘要\|e\d+$/);
    expect(calls[0]).not.toBe("应落盘的摘要|e0");
  });

  it("API compaction 后可喂视图变短且丢掉 firstKept 之前原文", () => {
    // 对齐真实狗粮：type=compaction + firstKeptEntryId
    const old = "字".repeat(400);
    const kept = "保留尾巴原文";
    const entries = [
      { id: "old1", type: "message", message: user(old, 1) },
      { id: "old2", type: "message", message: assistant(old, 2) },
      { id: "kept", type: "message", message: user(kept, 3) },
      {
        id: "c-api",
        type: "compaction",
        summary: "摘要：API已压旧文",
        firstKeptEntryId: "kept",
        tokensBefore: 9000,
      },
      { id: "new1", type: "message", message: user("压缩后新句", 4) },
    ];
    const without = feedMessagesFromBranch(entries.slice(0, 3), "本轮");
    const withBoundary = feedMessagesFromBranch(entries, "本轮");
    expect(estimateFeedChars(withBoundary)).toBeLessThan(estimateFeedChars(without));
    const prompt = transcriptToPrompt(withBoundary);
    expect(prompt).toContain(`${CONTEXT_COMPACTION_PREFIX}摘要：API已压旧文`);
    expect(prompt).toContain(kept);
    expect(prompt).toContain("压缩后新句");
    expect(prompt).not.toContain(old);
  });

  it("SDK custom_message 晚于 API compaction 时以更新边界为准", () => {
    // API→SDK 切换后两界并存：更晚的 agentup.context_compaction 覆盖旧 Pi 边界
    const prompt = transcriptToPrompt(
      feedMessagesFromBranch(
        [
          { id: "old", type: "message", message: user("更早长文应丢", 1) },
          { id: "kept", type: "message", message: user("Pi尾巴", 2) },
          {
            id: "c-api",
            type: "compaction",
            summary: "旧API摘要不应再主导",
            firstKeptEntryId: "kept",
          },
          { id: "mid", type: "message", message: user("API压后到SDK前的话也应丢", 3) },
          {
            id: "c-sdk",
            type: "custom_message",
            customType: CONTEXT_COMPACTION_CUSTOM_TYPE,
            content: "新SDK摘要",
            display: false,
            timestamp: 4,
          },
          { id: "tail", type: "message", message: user("SDK压后新句", 5) },
        ],
        "本轮",
      ),
    );
    expect(prompt).toContain(`${CONTEXT_COMPACTION_PREFIX}新SDK摘要`);
    expect(prompt).toContain("SDK压后新句");
    expect(prompt).not.toContain("旧API摘要不应再主导");
    expect(prompt).not.toContain("更早长文应丢");
    expect(prompt).not.toContain("Pi尾巴");
    expect(prompt).not.toContain("API压后到SDK前的话也应丢");
  });

  it("maybeCompactBranch：在已有 API compaction 上仍可再写 SDK 边界", async () => {
    const long = "字".repeat(300);
    const entries = [
      { id: "e1", type: "message", message: user(long, 1) },
      { id: "e2", type: "message", message: assistant(long, 2) },
      {
        id: "c-api",
        type: "compaction",
        summary: "先前API摘要",
        firstKeptEntryId: "e2",
      },
      { id: "e3", type: "message", message: user(long, 3) },
      { id: "e4", type: "message", message: assistant(long, 4) },
    ];
    const hidden: Array<{ type: string; content: string }> = [];
    const ok = await maybeCompactBranch({
      entries,
      userText: "继续",
      budgetChars: 50,
      summarize: async () => "SDK再压要点",
      sink: {
        appendCustomMessageEntry: (type, content) => {
          hidden.push({ type, content });
        },
      },
    });
    expect(ok).toBe(true);
    expect(hidden).toEqual([
      { type: CONTEXT_COMPACTION_CUSTOM_TYPE, content: "SDK再压要点" },
    ]);
  });

  it("maybeCompactBranch：超预算时调用 summarize 并落盘", async () => {
    const long = "字".repeat(200);
    const entries = [
      { type: "message", message: user(long, 1) },
      { type: "message", message: assistant(long, 2) },
    ];
    const hidden: string[] = [];
    const ok = await maybeCompactBranch({
      entries,
      userText: "继续",
      budgetChars: 50,
      summarize: async (plain) => {
        expect(plain.length).toBeGreaterThan(50);
        return "压缩后的要点";
      },
      sink: {
        appendCustomMessageEntry: (_type, content) => {
          hidden.push(content);
        },
      },
    });
    expect(ok).toBe(true);
    expect(hidden).toEqual(["压缩后的要点"]);
  });

  it("maybeCompactBranch：未超预算不调用 summarize", async () => {
    let called = false;
    const ok = await maybeCompactBranch({
      entries: [{ type: "message", message: user("短", 1) }],
      userText: "继续",
      budgetChars: 10_000,
      summarize: async () => {
        called = true;
        return "不应出现";
      },
      sink: { appendCustomMessageEntry: () => undefined },
    });
    expect(ok).toBe(false);
    expect(called).toBe(false);
  });

  it("runExternalSessionTurn：compactSummarize 超预算时先落盘再拼 prompt", async () => {
    const long = "字".repeat(120);
    const branch: unknown[] = [
      { type: "message", message: user(long, 1) },
      { type: "message", message: assistant(long, 2) },
    ];
    let seenPrompt = "";
    const session = {
      externalQuery: async (prompt: string) => {
        seenPrompt = prompt;
        return {
          iterable: (async function* () {
            yield {
              type: "result",
              subtype: "success",
              result: "ok",
              session_id: "s",
            };
          })(),
          controller: new AbortController(),
        };
      },
      sessionManager: {
        getBranch: () => branch,
        appendCustomMessageEntry: (type: string, content: string, display: boolean) => {
          branch.push({ type: "custom_message", customType: type, content, display, timestamp: 9 });
        },
        appendMessage: () => undefined,
      },
      subscribe: () => () => undefined,
      prompt: async () => undefined,
      abort: async () => undefined,
      dispose: () => undefined,
    };

    await runExternalSessionTurn({
      session: session as never,
      text: "本轮",
      write: () => undefined,
      errorPolicy: "prompt",
      compactBudgetChars: 80,
      compactSummarize: async () => "回合压缩摘要",
    });

    expect(seenPrompt).toContain("回合压缩摘要");
    expect(seenPrompt).toContain("本轮");
    expect(seenPrompt).not.toContain(long);
  });
});
