import { expect, it } from "vitest";

import { shouldDismissHitlOnStop } from "../../src/pages/conversation/model/hitl-dismiss.js";

it("dismisses HITL only when a running turn stops as incomplete/cancelled", () => {
  expect(shouldDismissHitlOnStop(false, false, { type: "incomplete", reason: "cancelled" })).toBe(
    false,
  );
  expect(shouldDismissHitlOnStop(true, true, { type: "incomplete", reason: "cancelled" })).toBe(
    false,
  );
  expect(shouldDismissHitlOnStop(true, false, { type: "complete" })).toBe(false);
  expect(shouldDismissHitlOnStop(true, false, { type: "incomplete", reason: "cancelled" })).toBe(
    true,
  );
  expect(shouldDismissHitlOnStop(true, false, { type: "incomplete", reason: "error" })).toBe(true);
  expect(shouldDismissHitlOnStop(true, false, { reason: "cancelled" })).toBe(true);
});
