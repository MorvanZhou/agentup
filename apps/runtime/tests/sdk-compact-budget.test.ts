import { describe, expect, it } from "vitest";

import { DEFAULT_CONTEXT_WINDOW } from "../src/config/model-catalog.js";
import {
  CHARS_PER_TOKEN_ESTIMATE,
  COMPACT_HARD_TRUNCATE_RATIO,
  COMPACT_TRIGGER_RATIO,
  compactBudgetsFromContextWindow,
  resolveContextWindowTokens,
} from "../src/session/external/sdk/host/budget.js";

describe("compactBudgetsFromContextWindow", () => {
  it("缺窗回落 128k", () => {
    expect(resolveContextWindowTokens(undefined)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextWindowTokens(0)).toBe(DEFAULT_CONTEXT_WINDOW);
    const budgets = compactBudgetsFromContextWindow(undefined);
    expect(budgets.contextWindowTokens).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("触发约 90%、硬裁约 95%（字符=token×4）", () => {
    const window = 200_000;
    const budgets = compactBudgetsFromContextWindow(window);
    expect(budgets.triggerChars).toBe(
      Math.floor(window * COMPACT_TRIGGER_RATIO) * CHARS_PER_TOKEN_ESTIMATE,
    );
    expect(budgets.hardTruncateChars).toBe(
      Math.floor(window * COMPACT_HARD_TRUNCATE_RATIO) * CHARS_PER_TOKEN_ESTIMATE,
    );
    expect(budgets.triggerChars).toBeLessThan(budgets.hardTruncateChars);
  });

  it("更大窗触发阈值更高", () => {
    const small = compactBudgetsFromContextWindow(64_000);
    const large = compactBudgetsFromContextWindow(1_000_000);
    expect(large.triggerChars).toBeGreaterThan(small.triggerChars);
  });
});
