import { afterEach, expect, it } from "vitest";

import {
  resetAssistStartMsCacheForTests,
  resolveAssistStartMs,
} from "../../src/pages/conversation/model/message/assist-elapsed.js";

afterEach(() => {
  resetAssistStartMsCacheForTests();
});

it("优先用 part 墙钟 startedAt", () => {
  expect(
    resolveAssistStartMs(
      {
        agentId: "weaty",
        toolCallId: "tc-1",
        status: "running",
        startedAt: 1_000,
      },
      5_000,
    ),
  ).toBe(1_000);
});

it("无 startedAt 时本地兜底，同 key 再次解析仍用首次起点（模拟切 tab 重挂）", () => {
  const assist = {
    agentId: "weaty",
    toolCallId: "tc-weaty",
    status: "running" as const,
  };
  expect(resolveAssistStartMs(assist, 10_000)).toBe(10_000);
  expect(resolveAssistStartMs(assist, 25_000)).toBe(10_000);
});

it("非 running 且无 startedAt 不展示耗时起点", () => {
  expect(
    resolveAssistStartMs(
      {
        agentId: "weaty",
        toolCallId: "tc-1",
        status: "completed",
      },
      10_000,
    ),
  ).toBeUndefined();
});
