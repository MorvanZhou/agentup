import { expect, it } from "vitest";

import {
  SIDEBAR_MIN_WIDTH,
  THREAD_MIN_WIDTH,
  clampPaneWidth,
  clampWorkspaceWidth,
  maxSidebarWidth,
  maxWorkspaceWidth,
} from "../../src/pages/conversation/model/pane-width.js";

it("clamps pane widths to min and max", () => {
  expect(clampPaneWidth(100, 192, 400)).toBe(192);
  expect(clampPaneWidth(500, 192, 400)).toBe(400);
  expect(clampPaneWidth(250.6, 192, 400)).toBe(251);
  expect(clampPaneWidth(Number.NaN, 192, 400)).toBe(192);
});

it("keeps max widths above the mins", () => {
  expect(maxSidebarWidth(200)).toBe(SIDEBAR_MIN_WIDTH);
  expect(maxSidebarWidth(800)).toBe(360);
  expect(maxWorkspaceWidth(800)).toBe(440);
  expect(maxWorkspaceWidth(500)).toBe(500 - THREAD_MIN_WIDTH);
  expect(maxWorkspaceWidth(200)).toBe(0);
});

it("clamps workspace width without eating the thread min", () => {
  expect(clampWorkspaceWidth(400, 800)).toBe(400);
  expect(clampWorkspaceWidth(400, 500)).toBe(500 - THREAD_MIN_WIDTH);
  expect(clampWorkspaceWidth(100, 800)).toBe(224);
});
