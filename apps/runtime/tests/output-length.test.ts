import { expect, it, vi } from "vitest";

import {
  AGENTUP_OUTPUT_LENGTH_CONTINUE_TYPE,
  OUTPUT_LENGTH_CONTINUE_PROMPT,
  createOutputLengthExtension,
  inspectLastAssistantMessage,
  resolveEmptyAssistantError,
  shouldAutoContinueOutputLength,
} from "../src/session/output-length.js";

it("inspects last assistant stopReason and content kinds", () => {
  const inspection = inspectLastAssistantMessage([
    {
      type: "message",
      message: {
        role: "assistant",
        stopReason: "length",
        content: [{ type: "thinking", thinking: "plan…" }],
      },
    },
  ]);
  expect(inspection).toEqual({
    stopReason: "length",
    hasText: false,
    hasToolCall: false,
    hasThinking: true,
  });
});

it("auto-continues any length within the bound, including reasoning-only", () => {
  const reasoningOnly = {
    stopReason: "length",
    hasText: false,
    hasToolCall: false,
    hasThinking: true,
  };
  expect(shouldAutoContinueOutputLength(reasoningOnly, 0, 2)).toBe(true);
  expect(shouldAutoContinueOutputLength(reasoningOnly, 1, 2)).toBe(true);
  expect(shouldAutoContinueOutputLength(reasoningOnly, 2, 2)).toBe(false);
  expect(
    shouldAutoContinueOutputLength({ ...reasoningOnly, stopReason: "stop" }, 0, 2),
  ).toBe(false);
});

it("extension requests continue with a hidden custom_message on length", async () => {
  const factory = createOutputLengthExtension({ maxContinuations: 2 });
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  factory({
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(event, handler);
      return () => undefined;
    },
  } as never);

  const start = handlers.get("agent_start");
  const settle = handlers.get("agent_before_settle");
  expect(start).toBeTypeOf("function");
  expect(settle).toBeTypeOf("function");

  start!({}, {});
  const branch = [
    {
      type: "message",
      message: {
        role: "assistant",
        stopReason: "length",
        content: [{ type: "thinking", thinking: "still planning" }],
      },
    },
  ];
  const ctx = { sessionManager: { getBranch: () => branch } };
  const baseEvent = {
    outcome: "completed",
    entries: [],
    continue: false,
    context: { canContinue: true },
  };

  const first = await settle!(baseEvent, ctx);
  expect(first).toEqual({
    entries: [
      {
        type: "custom_message",
        customType: AGENTUP_OUTPUT_LENGTH_CONTINUE_TYPE,
        content: OUTPUT_LENGTH_CONTINUE_PROMPT,
        display: false,
      },
    ],
    continue: true,
  });

  const second = await settle!(baseEvent, ctx);
  expect(second?.continue).toBe(true);

  const third = await settle!(baseEvent, ctx);
  expect(third).toBeUndefined();
});

it("extension does not continue when aborted or canContinue is false", async () => {
  const factory = createOutputLengthExtension();
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  factory({
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(event, handler);
      return () => undefined;
    },
  } as never);
  handlers.get("agent_start")!({}, {});
  const settle = handlers.get("agent_before_settle")!;
  const ctx = {
    sessionManager: {
      getBranch: () => [
        {
          type: "message",
          message: { role: "assistant", stopReason: "length", content: [] },
        },
      ],
    },
  };

  expect(
    await settle(
      { outcome: "aborted", entries: [], context: { canContinue: true } },
      ctx,
    ),
  ).toBeUndefined();
  expect(
    await settle(
      { outcome: "completed", entries: [], context: { canContinue: false } },
      ctx,
    ),
  ).toBeUndefined();
});

it("resolveEmptyAssistantError prefers stream degeneration when flagged", async () => {
  const { noteStreamDegeneration } = await import("../src/session/stream-guard.js");
  const manager = { getBranch: () => [], id: "deg" } as { getBranch: () => []; id: string };
  noteStreamDegeneration(manager);
  expect(resolveEmptyAssistantError(manager, "zh")).toContain("自动停止");
});

it("resolveEmptyAssistantError distinguishes length from plain empty", () => {
  const lengthManager = {
    getBranch: () => [
      {
        type: "message",
        message: {
          role: "assistant",
          stopReason: "length",
          content: [{ type: "thinking", thinking: "x" }],
        },
      },
    ],
  };
  const emptyManager = {
    getBranch: () => [
      {
        type: "message",
        message: { role: "assistant", stopReason: "stop", content: [] },
      },
    ],
  };
  expect(resolveEmptyAssistantError(lengthManager, "zh")).toContain("输出达到模型上限");
  expect(resolveEmptyAssistantError(emptyManager, "zh")).toBe("未返回可用结果");
  expect(resolveEmptyAssistantError(lengthManager, "en")).toMatch(/output hit/i);
});

it("resets continuation budget on each agent_start", async () => {
  const factory = createOutputLengthExtension({ maxContinuations: 1 });
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  factory({
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(event, handler);
      return vi.fn();
    },
  } as never);
  const start = handlers.get("agent_start")!;
  const settle = handlers.get("agent_before_settle")!;
  const ctx = {
    sessionManager: {
      getBranch: () => [
        {
          type: "message",
          message: { role: "assistant", stopReason: "length", content: [] },
        },
      ],
    },
  };
  const event = { outcome: "completed", entries: [], context: { canContinue: true } };

  start({}, {});
  expect((await settle(event, ctx))?.continue).toBe(true);
  expect(await settle(event, ctx)).toBeUndefined();

  start({}, {});
  expect((await settle(event, ctx))?.continue).toBe(true);
});
