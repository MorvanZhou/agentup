import { expect, it } from "vitest";

import {
  THREAD_WINDOW_PAGE,
  expandWindowStart,
  initialWindowStart,
  followLatestAfterPrepend,
  nextEarlierAutoLoad,
  scrollTopForAnchor,
  visibleMessageIds,
} from "../../src/pages/conversation/model/thread/thread-window.js";

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

it("loads one earlier page, then waits until the sentinel leaves", () => {
  expect(nextEarlierAutoLoad(true, true)).toEqual({ load: true, armed: false });
  expect(nextEarlierAutoLoad(false, true)).toEqual({ load: false, armed: false });
  expect(nextEarlierAutoLoad(false, false)).toEqual({ load: false, armed: true });
  expect(nextEarlierAutoLoad(true, true)).toEqual({ load: true, armed: false });
});

it("keeps the reading anchor and does not follow the latest message from mid-history", () => {
  expect(scrollTopForAnchor(12, 40, 180)).toBe(152);
  expect(followLatestAfterPrepend(0, 400, 800)).toBe(true);
  expect(followLatestAfterPrepend(240, 1200, 800)).toBe(false);
  expect(followLatestAfterPrepend(400, 1200, 800)).toBe(true);
});

it("keeps the newest side when slicing visible ids", () => {
  const ids = ["a", "b", "c", "d", "e"];
  expect(visibleMessageIds(ids, 0)).toEqual(ids);
  expect(visibleMessageIds(ids, 2)).toEqual(["c", "d", "e"]);
  expect(visibleMessageIds(ids, 5)).toEqual([]);
});
