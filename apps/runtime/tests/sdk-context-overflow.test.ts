/**
 * 厂商上下文超限：adaptor 文案识别 → stamp code；Host 只认 code 做单次重试。
 */
import { describe, expect, it } from "vitest";

import { isClaudeCodeContextOverflowText } from "../src/session/external/sdk/adapters/claude-code/context-overflow.js";
import { isCodexContextOverflowText } from "../src/session/external/sdk/adapters/codex/context-overflow.js";
import { isCopilotContextOverflowText } from "../src/session/external/sdk/adapters/copilot/context-overflow.js";
import { workerResultFromCopilotMessage } from "../src/session/external/sdk/adapters/copilot/stream.js";
import { isCursorContextOverflowText } from "../src/session/external/sdk/adapters/cursor/context-overflow.js";
import { isOpencodeContextOverflowText } from "../src/session/external/sdk/adapters/opencode/context-overflow.js";
import {
  CONTEXT_OVERFLOW_CODE,
  CONTEXT_OVERFLOW_MESSAGE_MAX_CHARS,
  isContextOverflowResult,
  isShortOverflowCandidate,
} from "../src/session/external/sdk/host/context-overflow.js";
import { runExternalSessionTurn } from "../src/session/turn/external-turn.js";

describe("adaptor overflow 文案（短闸）", () => {
  it("Copilot prompt budget", () => {
    expect(
      isCopilotContextOverflowText(
        "Execution failed: Request exceeds the model's prompt budget after reserving output (518123 tokens; limit 272000). Reduce context or compact before continuing.",
      ),
    ).toBe(true);
    expect(isCopilotContextOverflowText("network timeout")).toBe(false);
  });

  it("Claude Code / Codex / Cursor / OpenCode 样例", () => {
    expect(isClaudeCodeContextOverflowText("Prompt is too long")).toBe(true);
    expect(isClaudeCodeContextOverflowText("Context limit reached · /compact or /clear to continue")).toBe(
      true,
    );
    expect(
      isCodexContextOverflowText(
        "Codex ran out of room in the model's context window. Start a new conversation or clear earlier history before retrying.",
      ),
    ).toBe(true);
    expect(
      isCodexContextOverflowText(
        "Your input exceeds the context window of this model. Please adjust your input and try again.",
      ),
    ).toBe(true);
    expect(isCursorContextOverflowText("Conversation Too Long")).toBe(true);
    expect(isCursorContextOverflowText("rate limit exceeded")).toBe(false);
    expect(
      isOpencodeContextOverflowText("prompt is too long: 210602 tokens > 200000 maximum"),
    ).toBe(true);
  });

  it("长正文即使含关键词也不当 overflow", () => {
    const long =
      "以下是排查笔记。Request exceeds the model's prompt budget after reserving output。" +
      "x".repeat(CONTEXT_OVERFLOW_MESSAGE_MAX_CHARS);
    expect(isShortOverflowCandidate(long)).toBe(false);
    expect(isCopilotContextOverflowText(long)).toBe(false);
  });
});

describe("Host 只认 code", () => {
  it("认 error.code === context_overflow", () => {
    expect(
      isContextOverflowResult({
        finalText: "",
        finishReason: "error",
        permissionDenials: 0,
        error: { code: CONTEXT_OVERFLOW_CODE, message: "x".repeat(CONTEXT_OVERFLOW_MESSAGE_MAX_CHARS + 50) },
      }),
    ).toBe(true);
  });

  it("无 code 的原文 Host 不认（须 adaptor stamp）", () => {
    expect(
      isContextOverflowResult({
        finalText: "",
        finishReason: "error",
        permissionDenials: 0,
        error: {
          code: "error_during_execution",
          message:
            "Request exceeds the model's prompt budget after reserving output (1; limit 2)",
        },
      }),
    ).toBe(false);
  });

  it("Copilot normalizeResult 会 stamp code", () => {
    const result = workerResultFromCopilotMessage({
      type: "result",
      subtype: "error_during_execution",
      result: "",
      errors: [
        "Execution failed: Request exceeds the model's prompt budget after reserving output (1; limit 2).",
      ],
      session_id: "s",
      permission_denials: [],
    });
    expect(result?.error?.code).toBe(CONTEXT_OVERFLOW_CODE);
    expect(isContextOverflowResult(result)).toBe(true);
  });
});

describe("runExternalSessionTurn overflow 单次重试", () => {
  it("adaptor stamp 后 → force compact → 重试成功", async () => {
    const long = "旧文".repeat(40);
    const branch: unknown[] = [
      {
        type: "message",
        message: {
          role: "user",
          content: long,
          timestamp: 1,
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: long }],
          timestamp: 2,
          stopReason: "stop",
        },
      },
    ];
    let attempts = 0;
    let summarizeCalls = 0;
    const appended: Array<{ type: string; content?: string }> = [];

    const session = {
      externalQuery: async (prompt: string) => {
        attempts += 1;
        if (attempts === 1) {
          return {
            iterable: (async function* () {
              yield {
                type: "result",
                subtype: "error_during_execution",
                result: "",
                errors: [
                  "Execution failed: Request exceeds the model's prompt budget after reserving output (518123 tokens; limit 272000). Reduce context or compact before continuing.",
                ],
                session_id: "s1",
                permission_denials: [],
              };
            })(),
            controller: new AbortController(),
            // 模拟 turn-factory 透传的 driver.normalizeResult
            normalizeResult: workerResultFromCopilotMessage,
          };
        }
        expect(prompt).toContain("溢出后摘要");
        expect(prompt).not.toContain(long);
        return {
          iterable: (async function* () {
            yield {
              type: "result",
              subtype: "success",
              result: "重试成功",
              session_id: "s2",
              permission_denials: [],
            };
          })(),
          controller: new AbortController(),
          normalizeResult: workerResultFromCopilotMessage,
        };
      },
      sessionManager: {
        getBranch: () => branch,
        appendCustomMessageEntry: (type: string, content: string, display: boolean) => {
          branch.push({
            type: "custom_message",
            customType: type,
            content,
            display,
            timestamp: 9,
          });
          appended.push({ type, content });
        },
        appendMessage: (message: unknown) => {
          branch.push({ type: "message", message });
          appended.push({ type: "message" });
        },
      },
      subscribe: () => () => undefined,
      prompt: async () => undefined,
      abort: async () => undefined,
      dispose: () => undefined,
    };

    const result = await runExternalSessionTurn({
      session: session as never,
      text: "本轮",
      userText: "本轮",
      write: () => undefined,
      errorPolicy: "prompt",
      compactBudgetChars: 10_000_000,
      compactSummarize: async () => {
        summarizeCalls += 1;
        return "溢出后摘要";
      },
    });

    expect(attempts).toBe(2);
    expect(summarizeCalls).toBe(1);
    expect(result?.result?.finishReason).toBe("completed");
    expect(result?.visibleText || result?.result?.finalText).toContain("重试成功");
    expect(appended.some((row) => row.type === "agentup.context_compaction")).toBe(true);
  });

  it("非 overflow 错误不重试", async () => {
    let attempts = 0;
    const session = {
      externalQuery: async () => {
        attempts += 1;
        return {
          iterable: (async function* () {
            yield {
              type: "result",
              subtype: "error_during_execution",
              result: "",
              errors: ["network timeout"],
              session_id: "s",
              permission_denials: [],
            };
          })(),
          controller: new AbortController(),
          normalizeResult: workerResultFromCopilotMessage,
        };
      },
      sessionManager: {
        getBranch: () => [],
        appendCustomMessageEntry: () => undefined,
        appendMessage: () => undefined,
      },
      subscribe: () => () => undefined,
      prompt: async () => undefined,
      abort: async () => undefined,
      dispose: () => undefined,
    };

    const result = await runExternalSessionTurn({
      session: session as never,
      text: "hi",
      write: () => undefined,
      errorPolicy: "prompt",
      compactSummarize: async () => "不应调用",
    });

    expect(attempts).toBe(1);
    expect(result?.result?.finishReason).toBe("error");
  });
});
