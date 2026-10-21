import { expect, it } from "vitest";

import { surfaceHitlAgentId } from "../src/session/hitl-surface.js";

it("keeps origin agent when not nested", () => {
  expect(
    surfaceHitlAgentId("weather", {
      busyAgentIds: ["personal-assistant"],
    }),
  ).toBe("weather");
});

it("surfaces nested child HITL to busy parent", () => {
  expect(
    surfaceHitlAgentId("weather", {
      nestingParentId: "personal-assistant",
      busyAgentIds: ["personal-assistant"],
    }),
  ).toBe("personal-assistant");
});

it("keeps child when nesting parent is no longer busy (async delegate)", () => {
  expect(
    surfaceHitlAgentId("weather", {
      nestingParentId: "personal-assistant",
      busyAgentIds: [],
    }),
  ).toBe("weather");
});
