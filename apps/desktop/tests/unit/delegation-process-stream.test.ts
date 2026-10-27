import { expect, it } from "vitest";
import type { UIMessage } from "ai";

import {
  assistantPartCount,
  shouldApplyStreamMessage,
} from "../../src/pages/conversation/model/thread/delegation-process-stream.js";

function assistant(parts: number, id = "a"): UIMessage {
  return {
    id,
    role: "assistant",
    parts: Array.from({ length: parts }, (_, index) => ({
      type: "text",
      text: `p${index}`,
    })),
  } as UIMessage;
}

it("counts parts on the last assistant message", () => {
  expect(assistantPartCount([])).toBe(0);
  expect(
    assistantPartCount([
      { id: "u", role: "user", parts: [{ type: "text", text: "hi" }] } as UIMessage,
      assistant(5),
    ]),
  ).toBe(5);
});

it("applies stream immediately when there is no history floor", () => {
  expect(shouldApplyStreamMessage(assistant(1), 0)).toBe(true);
});

it("skips stream replay snapshots that are still behind history", () => {
  expect(shouldApplyStreamMessage(assistant(2), 5)).toBe(false);
  expect(shouldApplyStreamMessage(assistant(4), 5)).toBe(false);
});

it("applies stream once it catches up to history part count", () => {
  expect(shouldApplyStreamMessage(assistant(5), 5)).toBe(true);
  expect(shouldApplyStreamMessage(assistant(6), 5)).toBe(true);
});
