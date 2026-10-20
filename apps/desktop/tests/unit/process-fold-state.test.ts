import { expect, it } from "vitest";

import {
  clearProcessFoldState,
  getProcessFoldOverride,
  setProcessFoldOverride,
} from "../../src/pages/conversation/model/process-fold-state.js";

it("stores fold overrides per agent/message/group and clears on re-enter", () => {
  clearProcessFoldState("");
  setProcessFoldOverride("weather", "msg-1", "g-0", true);
  setProcessFoldOverride("doctor", "msg-2", "g-0", true);
  expect(getProcessFoldOverride("weather", "msg-1", "g-0")).toBe(true);
  clearProcessFoldState("weather");
  expect(getProcessFoldOverride("weather", "msg-1", "g-0")).toBeUndefined();
  expect(getProcessFoldOverride("doctor", "msg-2", "g-0")).toBe(true);
  clearProcessFoldState("");
  expect(getProcessFoldOverride("doctor", "msg-2", "g-0")).toBeUndefined();
});
