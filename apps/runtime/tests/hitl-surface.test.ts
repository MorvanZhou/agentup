import { expect, it } from "vitest";

import { delegationHitlAttribution, surfaceHitlAgentId } from "../src/session/hitl/surface.js";

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

it("labels a delegation card with the specialist name and a short brief", () => {
  expect(
    delegationHitlAttribution({
      toAgentName: "Remy",
      brief: "把迷宫需求问清楚，不要写代码。",
    }),
  ).toEqual({
    askedByName: "Remy",
    taskLabel: "把迷宫需求问清楚，不要写代码。",
  });
});

it("surfaces async delegation HITL to the parent even when the parent is idle", () => {
  expect(
    surfaceHitlAgentId("weather", {
      nestingParentId: "personal-assistant",
      busyAgentIds: [],
      origin: "delegation",
    }),
  ).toBe("personal-assistant");
});
