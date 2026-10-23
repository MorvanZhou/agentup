import { expect, it } from "vitest";

import {
  STREAM_GUARD_SPECIAL_ABORT_COUNT,
  consumeStreamDegeneration,
  createStreamGuardExtension,
  createStreamGuardState,
  feedDelta,
  hasTailRepetition,
  noteStreamDegeneration,
  sanitizeStreamText,
  streamDegenerationAbortedMessage,
} from "../src/session/stream-guard.js";

it("sanitize strips Hunyuan and ChatML special tokens, keeps prose", () => {
  const input =
    "你好<｜hy_place▁holder▁no▁813｜>世界<|im_end|><|im_start|>assistant";
  const { text, specialCount, pending } = sanitizeStreamText(input);
  expect(text).toBe("你好世界assistant");
  expect(specialCount).toBe(3);
  expect(pending).toBe("");
});

it("sanitize keeps unclosed half-token as pending", () => {
  const { text, pending, specialCount } = sanitizeStreamText("前置<|im_en");
  expect(text).toBe("前置");
  expect(pending).toBe("<|im_en");
  expect(specialCount).toBe(0);
});

it("sanitize does not strip ordinary HTML tags", () => {
  const { text, specialCount } = sanitizeStreamText("用 <div>ok</div> 包裹");
  expect(text).toBe("用 <div>ok</div> 包裹");
  expect(specialCount).toBe(0);
});

it("feedDelta aborts after enough Hunyuan placeholders", () => {
  const state = createStreamGuardState();
  const token = "<｜hy_place▁holder▁no▁813｜>";
  let aborted = false;
  for (let i = 0; i < STREAM_GUARD_SPECIAL_ABORT_COUNT; i += 1) {
    const result = feedDelta(state, token);
    if (result.abort) aborted = true;
    expect(result.text).toBe("");
  }
  expect(aborted).toBe(true);
  expect(state.specialHits).toBe(STREAM_GUARD_SPECIAL_ABORT_COUNT);
});

it("feedDelta aborts on ChatML flood across deltas", () => {
  const state = createStreamGuardState();
  let aborted = false;
  for (let i = 0; i < STREAM_GUARD_SPECIAL_ABORT_COUNT; i += 1) {
    const result = feedDelta(state, "<|im_end|>");
    if (result.abort) aborted = true;
  }
  expect(aborted).toBe(true);
});

it("feedDelta does not abort on normal prose", () => {
  const state = createStreamGuardState();
  const result = feedDelta(
    state,
    "这是一段正常说明，包含偶尔的 <div> 标签与单独的 <| 半截也不应触发。",
  );
  expect(result.abort).toBe(false);
  expect(result.text).toContain("<div>");
  expect(result.text).toContain("<| 半截");
  expect(state.pending).toBe("");
});

it("feedDelta completes a special token split across deltas then counts it", () => {
  const state = createStreamGuardState();
  const first = feedDelta(state, "hi<|im_");
  expect(first.text).toBe("hi");
  expect(first.abort).toBe(false);
  expect(state.pending).toBe("<|im_");

  const second = feedDelta(state, "end|>more");
  expect(second.text).toBe("more");
  expect(state.specialHits).toBe(1);
  expect(state.pending).toBe("");
});

it("hasTailRepetition detects repeated phrase tails", () => {
  const unit = "这是一段会重复的尾巴。"; // ≥ minUnit(8)
  const text = unit.repeat(8);
  expect(hasTailRepetition(text, 8, 256, 8)).toBe(true);
  expect(hasTailRepetition("短句不重复。", 8, 256, 8)).toBe(false);
});

it("feedDelta aborts on tail phrase repetition", () => {
  const state = createStreamGuardState();
  const unit = "这是一段会重复的尾巴。";
  let aborted = false;
  for (let i = 0; i < 10; i += 1) {
    const result = feedDelta(state, unit);
    if (result.abort) aborted = true;
  }
  expect(aborted).toBe(true);
});

it("note/consume stream degeneration is one-shot per session key", () => {
  const key = { id: "session-a" };
  expect(consumeStreamDegeneration(key)).toBe(false);
  noteStreamDegeneration(key);
  expect(consumeStreamDegeneration(key)).toBe(true);
  expect(consumeStreamDegeneration(key)).toBe(false);
});

it("streamDegenerationAbortedMessage has zh and en copy", () => {
  expect(streamDegenerationAbortedMessage("zh")).toContain("自动停止");
  expect(streamDegenerationAbortedMessage("en")).toMatch(/stopped/i);
});

it("extension aborts on special flood via message_update", () => {
  const factory = createStreamGuardExtension();
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  factory({
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(event, handler);
      return () => undefined;
    },
  } as never);

  const start = handlers.get("agent_start");
  const update = handlers.get("message_update");
  expect(start).toBeTypeOf("function");
  expect(update).toBeTypeOf("function");

  const sessionManager = { id: "mgr" };
  let aborted = false;
  const ctx = {
    sessionManager,
    abort() {
      aborted = true;
    },
  };

  start!({}, ctx);
  const token = "<｜hy_place▁holder▁no▁813｜>";
  for (let i = 0; i < STREAM_GUARD_SPECIAL_ABORT_COUNT; i += 1) {
    update!(
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: token },
      },
      ctx,
    );
  }
  expect(aborted).toBe(true);
  expect(consumeStreamDegeneration(sessionManager)).toBe(true);
});
