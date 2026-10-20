import { expect, it } from "vitest";

import {
  parseSummaryEntryData,
  resolveSummaryFromBranch,
} from "../src/session/summary.js";

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
