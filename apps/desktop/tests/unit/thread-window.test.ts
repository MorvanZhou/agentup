import { expect, it } from "vitest";

import {
  THREAD_WINDOW_PAGE,
  expandWindowStart,
  initialWindowStart,
  visibleMessageIds,
} from "../../src/pages/conversation/model/thread-window.js";

it("opens on the newest page", () => {
  expect(initialWindowStart(0)).toBe(0);
  expect(initialWindowStart(5)).toBe(0);
  expect(initialWindowStart(THREAD_WINDOW_PAGE)).toBe(0);
  expect(initialWindowStart(THREAD_WINDOW_PAGE + 3)).toBe(3);
  expect(initialWindowStart(100, 10)).toBe(90);
});

it("expands earlier pages until the start", () => {
  expect(expandWindowStart(30, 10)).toBe(20);
  expect(expandWindowStart(5, 10)).toBe(0);
  expect(expandWindowStart(0, 10)).toBe(0);
});

it("keeps the newest side when slicing visible ids", () => {
  const ids = ["a", "b", "c", "d", "e"];
  expect(visibleMessageIds(ids, 0)).toEqual(ids);
  expect(visibleMessageIds(ids, 2)).toEqual(["c", "d", "e"]);
  expect(visibleMessageIds(ids, 5)).toEqual([]);
});
