import { expect, it } from "vitest";

import {
  hitlOriginOf,
  isVisitOwnHitl,
  shouldBubbleNestedHitl,
} from "../src/session/hitl/origin.js";
import { surfaceHitlAgentId } from "../src/session/hitl/surface.js";

it("defaults missing origin to visit", () => {
  expect(hitlOriginOf({})).toBe("visit");
  expect(hitlOriginOf({ origin: "visit" })).toBe("visit");
  expect(hitlOriginOf({ origin: "delegation" })).toBe("delegation");
});

it("visit own HITL only matches same agent and visit origin", () => {
  expect(isVisitOwnHitl({ agentId: "draw", origin: "visit" }, "draw")).toBe(true);
  expect(isVisitOwnHitl({ agentId: "draw" }, "draw")).toBe(true);
  expect(isVisitOwnHitl({ agentId: "draw", origin: "delegation" }, "draw")).toBe(false);
  expect(isVisitOwnHitl({ agentId: "draw", origin: "visit" }, "ace")).toBe(false);
  expect(isVisitOwnHitl({ agentId: "draw", origin: "visit", groupId: "g1" }, "draw")).toBe(false);
});

it("bubbles only delegation-origin nested HITL to parent", () => {
  const nested = new Set(["draw"]);
  const isNestedUnder = (_u: string, parent: string, child: string) =>
    parent === "personal-assistant" && nested.has(child);
  const visit = { userId: "u1", agentId: "personal-assistant" };

  expect(
    shouldBubbleNestedHitl(
      { agentId: "draw", origin: "delegation", parentAgentId: "personal-assistant" },
      visit,
      isNestedUnder,
    ),
  ).toBe(true);

  // 直聊 Draw 的问卷：即使当时 Ace 正在委托 Draw，也不冒泡
  expect(
    shouldBubbleNestedHitl({ agentId: "draw", origin: "visit" }, visit, isNestedUnder),
  ).toBe(false);
  expect(shouldBubbleNestedHitl({ agentId: "draw" }, visit, isNestedUnder)).toBe(false);

  expect(
    shouldBubbleNestedHitl(
      { agentId: "draw", origin: "delegation", parentAgentId: "other-parent" },
      visit,
      isNestedUnder,
    ),
  ).toBe(false);
  expect(
    shouldBubbleNestedHitl(
      { agentId: "draw", origin: "delegation", parentAgentId: "personal-assistant", groupId: "g1" },
      visit,
      isNestedUnder,
    ),
  ).toBe(false);
});

it("attention surfaces only delegation-origin nested HITL", () => {
  expect(
    surfaceHitlAgentId("draw", {
      nestingParentId: "personal-assistant",
      busyAgentIds: ["personal-assistant"],
      origin: "delegation",
    }),
  ).toBe("personal-assistant");

  expect(
    surfaceHitlAgentId("draw", {
      nestingParentId: "personal-assistant",
      busyAgentIds: ["personal-assistant"],
      origin: "visit",
    }),
  ).toBe("draw");

  expect(
    surfaceHitlAgentId("draw", {
      nestingParentId: "personal-assistant",
      busyAgentIds: ["personal-assistant"],
    }),
  ).toBe("draw");
});
