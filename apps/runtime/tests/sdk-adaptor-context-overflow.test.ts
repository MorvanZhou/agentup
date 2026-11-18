/**
 * 各 adaptor 超限文案识别 + normalizeResult stamp → Host 只认 context_overflow。
 * 样例对齐真实厂商短报错（含 Copilot prompt budget）。
 */
import { describe, expect, it } from "vitest";

import { isCodebuddyContextOverflowText } from "../src/session/external/sdk/adapters/codebuddy/context-overflow.js";
import { isClaudeCodeContextOverflowText } from "../src/session/external/sdk/adapters/claude-code/context-overflow.js";
import { isCodexContextOverflowText } from "../src/session/external/sdk/adapters/codex/context-overflow.js";
import { isCopilotContextOverflowText } from "../src/session/external/sdk/adapters/copilot/context-overflow.js";
import { isCursorContextOverflowText } from "../src/session/external/sdk/adapters/cursor/context-overflow.js";
import { isDshContextOverflowText } from "../src/session/external/sdk/adapters/dsh/context-overflow.js";
import { isOpencodeContextOverflowText } from "../src/session/external/sdk/adapters/opencode/context-overflow.js";
import {
  CONTEXT_OVERFLOW_CODE,
  CONTEXT_OVERFLOW_MESSAGE_MAX_CHARS,
  isContextOverflowResult,
} from "../src/session/external/sdk/host/context-overflow.js";
import { getExternalDriver, listExternalDriverIds } from "../src/session/external/sdk/registry.js";

/** Copilot 用户反馈原文 */
const COPILOT_PROMPT_BUDGET =
  "Execution failed: Request exceeds the model's prompt budget after reserving output (518123 tokens; limit 272000). Reduce context or compact before continuing.";

type Case = {
  driverId: string;
  /** 本厂应识别并 stamp 的短超限文案 */
  overflowSamples: string[];
  /** 本厂不应误判 */
  nonOverflowSamples: string[];
  isOverflowText: (text: string) => boolean;
};

const CASES: Case[] = [
  {
    driverId: "copilot",
    overflowSamples: [
      COPILOT_PROMPT_BUDGET,
      "Request exceeds the model's prompt budget after reserving output (1; limit 2).",
    ],
    nonOverflowSamples: ["Execution failed: network timeout", "rate limit exceeded"],
    isOverflowText: isCopilotContextOverflowText,
  },
  {
    driverId: "claude-code",
    overflowSamples: [
      "Prompt is too long",
      "Input is too long for requested model",
      "Prompt is too long · automatic compaction failed: summarize timed out",
      "Context limit reached · /compact or /clear to continue",
      "API Error: 400 {\"type\":\"invalid_request_error\",\"message\":\"prompt is too long\"}",
    ],
    nonOverflowSamples: ["Usage credits required for 1M context", "rate limit exceeded"],
    isOverflowText: isClaudeCodeContextOverflowText,
  },
  {
    driverId: "codex",
    overflowSamples: [
      "Codex ran out of room in the model's context window. Start a new conversation or clear earlier history before retrying.",
      "Your input exceeds the context window of this model. Please adjust your input and try again.",
      "context_length_exceeded",
    ],
    nonOverflowSamples: ["network timeout", "rate limit exceeded"],
    isOverflowText: isCodexContextOverflowText,
  },
  {
    driverId: "cursor",
    overflowSamples: [
      "Conversation Too Long",
      "prompt is too long",
      "The context length exceeds the maximum allowed length for this model",
      "context_length_exceeded: request too large for model",
    ],
    nonOverflowSamples: ["rate limit exceeded", "too many requests, retry after 30s"],
    isOverflowText: isCursorContextOverflowText,
  },
  {
    driverId: "codebuddy",
    overflowSamples: [
      "prompt is too long: 210602 tokens > 200000 maximum",
      "Your input exceeds the context window of this model. Please adjust your input and try again.",
      "context_length_exceeded",
    ],
    nonOverflowSamples: ["network timeout", "502 Bad Gateway"],
    isOverflowText: isCodebuddyContextOverflowText,
  },
  {
    driverId: "opencode",
    overflowSamples: [
      "prompt is too long: 210602 tokens > 200000 maximum",
      "This model's maximum context length is 131072 tokens. However, you requested 140000 tokens",
      "input token count exceeds the maximum",
      "exceeds the context window",
      "input is too long for requested model",
    ],
    nonOverflowSamples: ["network timeout", "rate limit exceeded"],
    isOverflowText: isOpencodeContextOverflowText,
  },
  {
    driverId: "dsh",
    overflowSamples: [
      "prompt is too long",
      "Your input exceeds the context window of this model.",
      "maximum context length is 128000 tokens",
    ],
    nonOverflowSamples: ["network timeout", "aborted by user"],
    isOverflowText: isDshContextOverflowText,
  },
];

function errorResultMessage(text: string): unknown {
  return {
    type: "result",
    subtype: "error_during_execution",
    result: "",
    errors: [text],
    session_id: "overflow-test",
    permission_denials: [],
  };
}

describe("各 adaptor context-overflow 文案 + normalizeResult stamp", () => {
  it("registry 覆盖全部 CASES driver", () => {
    const ids = new Set(listExternalDriverIds());
    for (const row of CASES) {
      expect(ids.has(row.driverId), `缺少 driver ${row.driverId}`).toBe(true);
    }
    expect(CASES.map((row) => row.driverId).sort()).toEqual([...ids].sort());
  });

  for (const row of CASES) {
    describe(row.driverId, () => {
      it("识别本厂超限短文案", () => {
        for (const sample of row.overflowSamples) {
          expect(row.isOverflowText(sample), sample).toBe(true);
        }
      });

      it("不误判普通失败 / 限流", () => {
        for (const sample of row.nonOverflowSamples) {
          expect(row.isOverflowText(sample), sample).toBe(false);
        }
      });

      it("长正文含关键词也不认", () => {
        const long =
          `${row.overflowSamples[0] ?? "prompt is too long"} ` +
          "x".repeat(CONTEXT_OVERFLOW_MESSAGE_MAX_CHARS);
        expect(row.isOverflowText(long)).toBe(false);
      });

      it("normalizeResult stamp → Host isContextOverflowResult", () => {
        const driver = getExternalDriver(row.driverId);
        expect(typeof driver.normalizeResult).toBe("function");
        for (const sample of row.overflowSamples) {
          const stamped = driver.normalizeResult!(errorResultMessage(sample));
          expect(stamped?.finishReason, sample).toBe("error");
          expect(stamped?.error?.code, sample).toBe(CONTEXT_OVERFLOW_CODE);
          expect(isContextOverflowResult(stamped), sample).toBe(true);
        }
      });

      it("普通错误不 stamp context_overflow", () => {
        const driver = getExternalDriver(row.driverId);
        const stamped = driver.normalizeResult!(
          errorResultMessage(row.nonOverflowSamples[0] ?? "network timeout"),
        );
        expect(stamped?.finishReason).toBe("error");
        expect(stamped?.error?.code).not.toBe(CONTEXT_OVERFLOW_CODE);
        expect(isContextOverflowResult(stamped)).toBe(false);
      });
    });
  }

  it("Copilot 用户反馈原文仅 Copilot 识别（其它厂不误吃 prompt budget）", () => {
    expect(isCopilotContextOverflowText(COPILOT_PROMPT_BUDGET)).toBe(true);
    expect(isClaudeCodeContextOverflowText(COPILOT_PROMPT_BUDGET)).toBe(false);
    expect(isCodexContextOverflowText(COPILOT_PROMPT_BUDGET)).toBe(false);
    expect(isCursorContextOverflowText(COPILOT_PROMPT_BUDGET)).toBe(false);
    expect(isCodebuddyContextOverflowText(COPILOT_PROMPT_BUDGET)).toBe(false);
    expect(isOpencodeContextOverflowText(COPILOT_PROMPT_BUDGET)).toBe(false);
    expect(isDshContextOverflowText(COPILOT_PROMPT_BUDGET)).toBe(false);

    const stamped = getExternalDriver("copilot").normalizeResult!(
      errorResultMessage(COPILOT_PROMPT_BUDGET),
    );
    expect(stamped?.error?.code).toBe(CONTEXT_OVERFLOW_CODE);
  });
});
