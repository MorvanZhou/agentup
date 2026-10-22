import { expect, it } from "vitest";

import { surfaceHitlAgentId } from "../src/session/hitl/surface.js";

it("keeps origin agent when not nested", () => {
  expect(
    surfaceHitlAgentId("weather", {
      busyAgentIds: ["personal-assistant"],
    }),
  ).toBe("weather");
});

it("surfaces nested child HITL to busy parent only for delegation origin", () => {
  expect(
    surfaceHitlAgentId("weather", {
      nestingParentId: "personal-assistant",
      busyAgentIds: ["personal-assistant"],
      origin: "delegation",
    }),
  ).toBe("personal-assistant");
});

it("does not surface visit-origin child HITL even when nested under busy parent", () => {
  expect(
    surfaceHitlAgentId("weather", {
      nestingParentId: "personal-assistant",
      busyAgentIds: ["personal-assistant"],
      origin: "visit",
    }),
  ).toBe("weather");
});

it("keeps child when nesting parent is no longer busy (async delegate)", () => {
  expect(
    surfaceHitlAgentId("weather", {
      nestingParentId: "personal-assistant",
      busyAgentIds: [],
      origin: "delegation",
    }),
  ).toBe("weather");
});
