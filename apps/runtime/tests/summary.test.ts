import { expect, it } from "vitest";

import {
  parseSummaryEntryData,
  resolveSummaryFromBranch,
} from "../src/session/history/summary.js";
import { ASYNC_WAKE_CUSTOM_TYPE } from "../src/session/wake/index.js";

it("resolveSummaryFromBranch picks last non-empty text after the latest user", () => {
  const branch = [
    {
      type: "message",
      id: "u1",
      parentId: null,
      message: { role: "user", content: "hi" },
    },
    {
      type: "message",
      id: "a1",
      parentId: "u1",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "先说明" },
          { type: "toolCall", id: "c1", name: "bash", arguments: {} },
        ],
      },
    },
    {
      type: "message",
      id: "a2",
      parentId: "a1",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "最终总结" }],
      },
    },
  ] as never;

  expect(resolveSummaryFromBranch(branch)).toEqual({ textPartIndex: 1 });
});

it("resolveSummaryFromBranch ignores assistant text before an async wake", () => {
  const branch = [
    {
      type: "message",
      id: "u1",
      parentId: null,
      message: { role: "user", content: "hi" },
    },
    {
      type: "message",
      id: "a1",
      parentId: "u1",
      message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
    },
    {
      type: "custom_message",
      id: "w1",
      parentId: "a1",
      customType: ASYNC_WAKE_CUSTOM_TYPE,
      content: "done",
      display: false,
    },
    {
      type: "message",
      id: "a2",
      parentId: "w1",
      message: { role: "assistant", content: [{ type: "text", text: "跑完了" }] },
    },
  ] as never;
  expect(resolveSummaryFromBranch(branch)).toEqual({ textPartIndex: 0 });
});

it("resolveSummaryFromBranch returns undefined when there is no text", () => {
  const branch = [
    {
      type: "message",
      id: "u1",
      parentId: null,
      message: { role: "user", content: "hi" },
    },
    {
      type: "message",
      id: "a1",
      parentId: "u1",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }],
      },
    },
  ] as never;

  expect(resolveSummaryFromBranch(branch)).toBeUndefined();
});

it("parseSummaryEntryData rejects invalid payloads", () => {
  expect(parseSummaryEntryData({ textPartIndex: 0 })).toEqual({ textPartIndex: 0 });
  expect(parseSummaryEntryData({ textPartIndex: -1 })).toBeUndefined();
  expect(parseSummaryEntryData({})).toBeUndefined();
});
