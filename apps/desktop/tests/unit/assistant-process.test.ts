import { expect, it } from "vitest";

import {
  buildAssistantTimeline,
  formatGroupDuration,
  groupHasRunningPart,
  hasProcessGroups,
  hiddenTodoIndices,
  isPendingHitlPart,
  isProcessGroupDefaultOpen,
  processGroupTriggerLabel,
} from "../../src/pages/conversation/model/assistant-process.js";

it("splits contiguous non-text into groups between texts", () => {
  expect(
    buildAssistantTimeline([
      { type: "reasoning" },
      { type: "tool-call", toolName: "read", result: "ok" },
      { type: "text" },
      { type: "tool-call", toolName: "bash", result: "ok" },
      { type: "text" },
    ]),
  ).toEqual({
    items: [
      { kind: "group", id: "g-0", indices: [0, 1], stepCount: 2 },
      { kind: "text", index: 2 },
      { kind: "group", id: "g-3", indices: [3], stepCount: 1 },
      { kind: "text", index: 4 },
    ],
  });
});

it("keeps trailing tools after text as their own group", () => {
  expect(
    buildAssistantTimeline([
      { type: "reasoning" },
      { type: "text" },
      { type: "tool-call", result: "ok" },
    ]),
  ).toEqual({
    items: [
      { kind: "group", id: "g-0", indices: [0], stepCount: 1 },
      { kind: "text", index: 1 },
      { kind: "group", id: "g-2", indices: [2], stepCount: 1 },
    ],
  });
});

it("has no groups when only a text part exists", () => {
  const timeline = buildAssistantTimeline([{ type: "text" }]);
  expect(timeline).toEqual({ items: [{ kind: "text", index: 0 }] });
  expect(hasProcessGroups(timeline)).toBe(false);
});

it("folds the whole message when there is no text", () => {
  expect(
    buildAssistantTimeline([{ type: "tool-call", result: "ok" }, { type: "reasoning" }]),
  ).toEqual({
    items: [{ kind: "group", id: "g-0", indices: [0, 1], stepCount: 2 }],
  });
});

it("interrupts the timeline for pending ask_user and approval", () => {
  expect(
    buildAssistantTimeline(
      [
        { type: "reasoning" },
        { type: "tool-call", toolName: "ask_user", toolCallId: "ask-1" },
        { type: "tool-call", toolName: "read", toolCallId: "read-1", result: "ok" },
      ],
      { pendingAskUserToolCallId: "ask-1" },
    ),
  ).toEqual({
    items: [
      { kind: "group", id: "g-0", indices: [0], stepCount: 1 },
      { kind: "hitl", index: 1 },
      { kind: "group", id: "g-2", indices: [2], stepCount: 1 },
    ],
  });

  expect(
    isPendingHitlPart(
      { type: "tool-call", toolCallId: "ap-1" },
      { pendingApprovalToolCallId: "ap-1" },
    ),
  ).toBe(true);
});

it("exposes in-progress tools outside the closed fold", () => {
  expect(
    buildAssistantTimeline([
      { type: "text" },
      { type: "tool-call", toolName: "write", status: { type: "running" } },
    ]),
  ).toEqual({
    items: [
      { kind: "text", index: 0 },
      { kind: "hitl", index: 1 },
    ],
  });
});

it("puts answered ask_user back into a fold group", () => {
  expect(
    buildAssistantTimeline([
      { type: "tool-call", toolName: "ask_user", toolCallId: "ask-1", result: "ok" },
      { type: "text" },
    ]),
  ).toEqual({
    items: [
      { kind: "group", id: "g-0", indices: [0], stepCount: 1 },
      { kind: "text", index: 1 },
    ],
  });
});

it("hides later todo snapshots but keeps the first in the group", () => {
  const parts = [
    { type: "tool-call", toolName: "todo", result: "[ ] #1: a" },
    { type: "tool-call", toolName: "read", result: "ok" },
    { type: "tool-call", toolName: "todo", result: "[x] #1: a" },
    { type: "text" },
  ];
  expect([...hiddenTodoIndices(parts)]).toEqual([2]);
  expect(buildAssistantTimeline(parts)).toEqual({
    items: [
      { kind: "group", id: "g-0", indices: [0, 1], stepCount: 2 },
      { kind: "text", index: 3 },
    ],
  });
});

it("detects running parts and formats group duration", () => {
  expect(
    groupHasRunningPart(
      [
        { type: "tool-call", status: { type: "complete" }, result: "ok" },
        { type: "reasoning", status: { type: "running" } },
      ],
      [0, 1],
    ),
  ).toBe(true);

  expect(
    formatGroupDuration(
      [
        { type: "tool-call", timing: { startedAt: 1000, completedAt: 2500 } },
        { type: "reasoning", timing: { startedAt: 1200, completedAt: 3000 } },
      ],
      [0, 1],
    ),
  ).toBe("2.0s");

  expect(processGroupTriggerLabel(3)).toBe("3 个步骤");
  expect(processGroupTriggerLabel(3, "2.0s")).toBe("3 个步骤 · 2.0s");
  expect(processGroupTriggerLabel(1, "  ")).toBe("1 个步骤");
});

it("keeps process groups closed by default", () => {
  expect(
    groupHasRunningPart(
      [{ type: "tool-call", toolName: "write", result: undefined }],
      [0],
    ),
  ).toBe(true);
  expect(isProcessGroupDefaultOpen(false, true)).toBe(false);
  expect(isProcessGroupDefaultOpen(true, false)).toBe(false);
  expect(isProcessGroupDefaultOpen(false, false)).toBe(false);
});
