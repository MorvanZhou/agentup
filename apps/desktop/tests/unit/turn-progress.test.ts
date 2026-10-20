import { expect, it } from "vitest";

import {
  isAwaitingNextStep,
  isPartProgressActive,
  type TurnProgressPart,
} from "../../src/pages/conversation/model/turn-progress.js";

it("treats empty parts while message running as awaiting next step", () => {
  expect(isAwaitingNextStep([], true)).toBe(true);
  expect(isAwaitingNextStep([], false)).toBe(false);
});

it("awaits next step after a completed tool while message still running", () => {
  const parts: TurnProgressPart[] = [
    {
      type: "tool-call",
      status: { type: "complete" },
      result: "<html>…</html>",
    },
  ];
  expect(isAwaitingNextStep(parts, true)).toBe(true);
  expect(isAwaitingNextStep(parts, false)).toBe(false);
});

it("does not await when a tool is still active", () => {
  const running: TurnProgressPart = {
    type: "tool-call",
    status: { type: "running" },
  };
  const pending: TurnProgressPart = {
    type: "tool-call",
    status: { type: "complete" },
  };
  expect(isPartProgressActive(running)).toBe(true);
  expect(isPartProgressActive(pending)).toBe(true);
  expect(isAwaitingNextStep([running], true)).toBe(false);
  expect(isAwaitingNextStep([pending], true)).toBe(false);
});

it("does not await when text or reasoning is streaming", () => {
  const text: TurnProgressPart = {
    type: "text",
    status: { type: "running" },
  };
  const reasoning: TurnProgressPart = {
    type: "reasoning",
    status: { type: "running" },
  };
  expect(isAwaitingNextStep([text], true)).toBe(false);
  expect(isAwaitingNextStep([reasoning], true)).toBe(false);
});

it("does not await when message has finished", () => {
  const parts: TurnProgressPart[] = [
    { type: "text", status: { type: "complete" } },
    {
      type: "tool-call",
      status: { type: "complete" },
      result: "ok",
    },
  ];
  expect(isAwaitingNextStep(parts, false)).toBe(false);
});

it("marks cancelled and errored tools as inactive", () => {
  expect(
    isPartProgressActive({
      type: "tool-call",
      status: { type: "incomplete", reason: "cancelled" },
    }),
  ).toBe(false);
  expect(
    isPartProgressActive({
      type: "tool-call",
      status: { type: "incomplete", reason: "error" },
      isError: true,
    }),
  ).toBe(false);
  expect(
    isAwaitingNextStep(
      [
        {
          type: "tool-call",
          status: { type: "incomplete", reason: "cancelled" },
        },
      ],
      true,
    ),
  ).toBe(true);
});
