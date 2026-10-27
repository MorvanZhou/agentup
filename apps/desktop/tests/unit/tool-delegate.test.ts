import { expect, it } from "vitest";

import {
  argTrimmedString,
  checkDelegationSummary,
  clipToolDetail,
  fanoutTaskCount,
  resolveActionFromArgs,
  steerNoteFromArgs,
} from "../../src/pages/conversation/components/agent-main/thread/assistant-ui/tools/delegation/tool-delegate.js";

it("clips long tool details and reads common delegation args", () => {
  expect(clipToolDetail("short")).toBe("short");
  expect(clipToolDetail("x".repeat(50))).toBe(`${"x".repeat(47)}…`);
  expect(argTrimmedString({ query: "  design  " }, "query")).toBe("design");
  expect(fanoutTaskCount({ tasks: [{}, {}] })).toBe(2);
  expect(fanoutTaskCount({})).toBe(0);
  expect(steerNoteFromArgs({ note: "  use CSS  " })).toBe("use CSS");
  expect(resolveActionFromArgs({ action: "Steer" })).toBe("steer");
  expect(checkDelegationSummary({ task_id: "abc-123", task_ids: ["a", "b"] })).toEqual({
    taskId: "abc-123",
    taskIdCount: 2,
  });
  expect(checkDelegationSummary({})).toEqual({ taskId: "", taskIdCount: 0 });
});
