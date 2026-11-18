import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
} from "../src/config/model-catalog.js";
import {
  CHARS_PER_TOKEN_ESTIMATE,
  COMPACT_HARD_TRUNCATE_RATIO,
  COMPACT_TRIGGER_RATIO,
  MAX_OUTPUT_RESERVE_RATIO,
  compactBudgetsFromContextWindow,
  resolveContextWindowTokens,
  resolveEffectivePromptWindowTokens,
  resolveOutputReserveTokens,
} from "../src/session/external/sdk/host/budget.js";

describe("compactBudgetsFromContextWindow", () => {
  it("缺窗回落 128k，并扣默认输出预留", () => {
    expect(resolveContextWindowTokens(undefined)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextWindowTokens(0)).toBe(DEFAULT_CONTEXT_WINDOW);
    const budgets = compactBudgetsFromContextWindow(undefined);
    expect(budgets.contextWindowTokens).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(budgets.outputReserveTokens).toBe(DEFAULT_MAX_TOKENS);
    expect(budgets.effectiveWindowTokens).toBe(
      DEFAULT_CONTEXT_WINDOW - DEFAULT_MAX_TOKENS,
    );
  });

  it("无 maxTokens 时用 DEFAULT_MAX_TOKENS 作输出预留，再按 effective×90%/95%", () => {
    const window = 200_000;
    const effective = window - DEFAULT_MAX_TOKENS;
    const budgets = compactBudgetsFromContextWindow(window);
    expect(budgets.outputReserveTokens).toBe(DEFAULT_MAX_TOKENS);
    expect(budgets.effectiveWindowTokens).toBe(effective);
    expect(budgets.triggerChars).toBe(
      Math.floor(effective * COMPACT_TRIGGER_RATIO) * CHARS_PER_TOKEN_ESTIMATE,
    );
    expect(budgets.hardTruncateChars).toBe(
      Math.floor(effective * COMPACT_HARD_TRUNCATE_RATIO) * CHARS_PER_TOKEN_ESTIMATE,
    );
    expect(budgets.triggerChars).toBeLessThan(budgets.hardTruncateChars);
  });

  it("Copilot 形：400k 窗 − 128k 输出 → 有效 272k，触发线低于整窗 90%", () => {
    const window = 400_000;
    const maxTokens = 128_000;
    const effective = 272_000;
    expect(resolveOutputReserveTokens(window, maxTokens)).toBe(128_000);
    expect(resolveEffectivePromptWindowTokens(window, maxTokens)).toBe(effective);

    const budgets = compactBudgetsFromContextWindow(window, maxTokens);
    expect(budgets.contextWindowTokens).toBe(window);
    expect(budgets.outputReserveTokens).toBe(128_000);
    expect(budgets.effectiveWindowTokens).toBe(effective);
    expect(budgets.triggerChars).toBe(
      Math.floor(effective * COMPACT_TRIGGER_RATIO) * CHARS_PER_TOKEN_ESTIMATE,
    );
    // 若只按整窗 90% 会晚于厂商墙（272k）
    const naiveFullWindowTrigger =
      Math.floor(window * COMPACT_TRIGGER_RATIO) * CHARS_PER_TOKEN_ESTIMATE;
    expect(budgets.triggerChars).toBeLessThan(naiveFullWindowTrigger);
    expect(budgets.triggerChars).toBeLessThan(
      effective * CHARS_PER_TOKEN_ESTIMATE,
    );
  });

  it("输出预留不超过窗的一半，避免把有效输入吃光", () => {
    const window = 100_000;
    const hugeOutput = 90_000;
    const capped = Math.floor(window * MAX_OUTPUT_RESERVE_RATIO);
    expect(resolveOutputReserveTokens(window, hugeOutput)).toBe(capped);
    expect(resolveEffectivePromptWindowTokens(window, hugeOutput)).toBe(window - capped);
  });

  it("更大窗触发阈值更高（同预留比例）", () => {
    const small = compactBudgetsFromContextWindow(64_000, 8_000);
    const large = compactBudgetsFromContextWindow(1_000_000, 8_000);
    expect(large.triggerChars).toBeGreaterThan(small.triggerChars);
  });
});
