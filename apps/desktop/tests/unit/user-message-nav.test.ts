import { expect, it } from "vitest";

import {
  USER_MESSAGE_NAV_DOCK_RANGE,
  USER_MESSAGE_NAV_MIN,
  USER_MESSAGE_NAV_PREVIEW_MAX,
  activeUserNavId,
  collectUserMessageNavItems,
  shouldShowUserMessageNav,
  truncateUserNavPreview,
  userNavDockFalloff,
  userNavTickWidthPx,
  windowStartToInclude,
} from "../../src/pages/conversation/model/thread/user-message-nav.js";

it("shows nav only when user anchors reach the minimum", () => {
  expect(USER_MESSAGE_NAV_MIN).toBe(3);
  expect(shouldShowUserMessageNav(0)).toBe(false);
  expect(shouldShowUserMessageNav(2)).toBe(false);
  expect(shouldShowUserMessageNav(3)).toBe(true);
  expect(shouldShowUserMessageNav(10)).toBe(true);
});

it("collects chronological user anchors and skips reset / surface rows", () => {
  const items = collectUserMessageNavItems([
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "第一轮很长很长的问题内容需要截断" }],
    },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "答" }] },
    {
      id: "context-reset-1",
      role: "system",
      parts: [{ type: "text", text: "重置" }],
      metadata: { custom: { agentUpKind: "context-reset" } },
    },
    {
      id: "surface",
      role: "user",
      parts: [{ type: "text", text: "系统行" }],
      metadata: { custom: { groupLineRole: "system" } },
    },
    {
      id: "u2",
      role: "user",
      parts: [{ type: "text", text: "第二轮" }],
    },
    {
      id: "u3",
      role: "user",
      parts: [{ type: "text", text: "" }],
      // 仅附件时预览为空串，由 UI 回落词条
    },
  ]);

  expect(items.map((item) => item.id)).toEqual(["u1", "u2", "u3"]);
  expect(items[0]!.preview.startsWith("第一轮")).toBe(true);
  expect(items[0]!.preview.length).toBeLessThanOrEqual(USER_MESSAGE_NAV_PREVIEW_MAX + 1);
  expect(items[1]!.preview).toBe("第二轮");
  expect(items[2]!.preview).toBe("");
  expect(items.map((item) => item.index)).toEqual([0, 4, 5]);
  expect(shouldShowUserMessageNav(items.length)).toBe(true);
});

it("truncates preview to a single-line budget", () => {
  expect(truncateUserNavPreview("短")).toBe("短");
  expect(truncateUserNavPreview("  两边空格  ")).toBe("两边空格");
  const long = "字".repeat(USER_MESSAGE_NAV_PREVIEW_MAX + 8);
  const clipped = truncateUserNavPreview(long);
  expect(clipped.endsWith("…")).toBe(true);
  expect(clipped.length).toBe(USER_MESSAGE_NAV_PREVIEW_MAX);
});

it("computes window start that still includes the target message index", () => {
  // 目标已在窗口内（index >= start）：不动
  expect(windowStartToInclude(10, 15, 20)).toBe(10);
  expect(windowStartToInclude(5, 5, 20)).toBe(5);
  // 目标在裁剪上方：一次收到能盖住目标的起点
  expect(windowStartToInclude(10, 5, 20)).toBe(5);
  expect(windowStartToInclude(30, 12, 20)).toBe(12);
  expect(windowStartToInclude(40, 0, 20)).toBe(0);
  expect(windowStartToInclude(25, 3, 10)).toBe(3);
});

it("picks the last user whose top has crossed the pin line", () => {
  const users = [
    { id: "u1", top: 10 },
    { id: "u2", top: 80 },
    { id: "u3", top: 200 },
  ];
  expect(activeUserNavId(users, 100)).toBe("u2");
  expect(activeUserNavId(users, 5)).toBe("u1");
  expect(activeUserNavId(users, 250)).toBe("u3");
  expect(activeUserNavId([], 100)).toBe(null);
});

it("dock falloff peaks at the hovered index and decays by distance", () => {
  expect(userNavDockFalloff(0)).toBe(1);
  expect(userNavDockFalloff(USER_MESSAGE_NAV_DOCK_RANGE)).toBe(0);
  expect(userNavDockFalloff(USER_MESSAGE_NAV_DOCK_RANGE + 1)).toBe(0);
  expect(userNavDockFalloff(1)).toBeGreaterThan(0);
  expect(userNavDockFalloff(1)).toBeLessThan(1);
  expect(userNavDockFalloff(1)).toBeGreaterThan(userNavDockFalloff(2));
});

it("tick width grows with falloff and keeps a quiet active boost", () => {
  expect(userNavTickWidthPx({ falloff: 0 })).toBe(10);
  expect(userNavTickWidthPx({ falloff: 1, extra: 18 })).toBe(28);
  expect(userNavTickWidthPx({ falloff: 0, activeBoost: 0.35, extra: 8 })).toBe(10 + 8 * 0.35);
  expect(userNavTickWidthPx({ falloff: 0.5, activeBoost: 0.2, extra: 10 })).toBe(10 + 10 * 0.5);
});
