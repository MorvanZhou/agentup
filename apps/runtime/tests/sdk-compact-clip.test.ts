import { describe, expect, it } from "vitest";

import {
  CHARS_PER_TOKEN_ESTIMATE,
  COMPACT_INPUT_WINDOW_RATIO,
  clipTranscriptForCompact,
  buildCompactPrompt,
} from "../src/session/external/sdk/host/compact-sdk.js";

describe("clipTranscriptForCompact", () => {
  it("未超预算原样返回", () => {
    expect(clipTranscriptForCompact("短历史", 128_000)).toBe("短历史");
  });

  it("超预算时保留头尾并标明省略", () => {
    // 须大于 clip 内建下限 2000，否则预算被抬高后断言失真
    const window = 8_000;
    const budget = Math.max(
      2_000,
      Math.floor(window * CHARS_PER_TOKEN_ESTIMATE * COMPACT_INPUT_WINDOW_RATIO),
    );
    const text = `${"A".repeat(budget)}\n中间旧内容\n${"B".repeat(budget)}`;
    const clipped = clipTranscriptForCompact(text, window);
    expect(clipped.length).toBeLessThanOrEqual(budget + 40);
    expect(clipped.startsWith("A")).toBe(true);
    expect(clipped.endsWith("B")).toBe(true);
    expect(clipped).toContain("中间已省略");
    expect(clipped).not.toContain("中间旧内容");
  });
});

describe("buildCompactPrompt", () => {
  it("标明压缩任务并要求只输出摘要", () => {
    const prompt = buildCompactPrompt("用户：做 X\n助手：已做");
    expect(prompt).toContain("压缩上下文");
    expect(prompt).toContain("只输出");
    expect(prompt).toContain("用户：做 X");
  });
});
