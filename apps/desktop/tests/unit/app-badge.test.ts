import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const { applyAppBadge, normalizeCount } = createRequire(import.meta.url)(
  "../../electron/app-badge.cjs",
) as {
  applyAppBadge: (
    count: unknown,
    deps: {
      platform: string;
      dock?: { setBadge: (label: string) => void };
      setBadgeCount?: (count: number) => void;
    },
  ) => { count: number; label: string };
  normalizeCount: (count: unknown) => number;
};

it("normalizes badge counts", () => {
  expect(normalizeCount(0)).toBe(0);
  expect(normalizeCount(-2)).toBe(0);
  expect(normalizeCount(3.7)).toBe(3);
  expect(normalizeCount("2")).toBe(0);
  expect(normalizeCount(20_000)).toBe(9999);
});

it("sets macOS dock badge with 9+ label", () => {
  const setBadge = vi.fn();
  const setBadgeCount = vi.fn();
  expect(
    applyAppBadge(12, {
      platform: "darwin",
      dock: { setBadge },
      setBadgeCount,
    }),
  ).toEqual({ count: 12, label: "9+" });
  expect(setBadge).toHaveBeenCalledWith("9+");
  expect(setBadgeCount).not.toHaveBeenCalled();
});

it("clears macOS dock badge when unread is zero", () => {
  const setBadge = vi.fn();
  applyAppBadge(0, { platform: "darwin", dock: { setBadge } });
  expect(setBadge).toHaveBeenCalledWith("");
});

it("sets Windows taskbar badge count", () => {
  const setBadgeCount = vi.fn();
  expect(applyAppBadge(5, { platform: "win32", setBadgeCount })).toEqual({
    count: 5,
    label: "5",
  });
  expect(setBadgeCount).toHaveBeenCalledWith(5);
});
