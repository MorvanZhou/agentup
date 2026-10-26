import { expect, it } from "vitest";

import { formatAgentTime } from "../../src/shared/model/ui/time.js";

it("formats UTC ISO strings into local YYYY-MM-DD", () => {
  expect(formatAgentTime("2026-10-11T12:34:56.789Z")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it("returns empty for blank input and keeps invalid text", () => {
  expect(formatAgentTime("")).toBe("");
  expect(formatAgentTime("   ")).toBe("");
  expect(formatAgentTime("not-a-date")).toBe("not-a-date");
});
