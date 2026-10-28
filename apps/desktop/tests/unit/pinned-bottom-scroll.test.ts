import { describe, expect, it } from "vitest";

import {
  isScrollAtBottom,
  nextPinnedBottom,
} from "../../src/pages/conversation/model/thread/pinned-bottom-scroll";

describe("pinned-bottom-scroll", () => {
  it("detects bottom within 1px and when content fits", () => {
    expect(isScrollAtBottom(99, 200, 100)).toBe(true);
    expect(isScrollAtBottom(0, 80, 100)).toBe(true);
    expect(isScrollAtBottom(50, 200, 100)).toBe(false);
  });

  it("stays pinned when already at bottom", () => {
    expect(
      nextPinnedBottom({
        pinned: false,
        scrollTop: 100,
        lastScrollTop: 40,
        scrollHeight: 200,
        lastScrollHeight: 200,
        clientHeight: 100,
      }),
    ).toBe(true);
  });

  it("unpins only on upward scroll at unchanged height", () => {
    expect(
      nextPinnedBottom({
        pinned: true,
        scrollTop: 40,
        lastScrollTop: 80,
        scrollHeight: 200,
        lastScrollHeight: 200,
        clientHeight: 100,
      }),
    ).toBe(false);
  });

  it("does not unpin when content grew and pin lag looks off-bottom", () => {
    expect(
      nextPinnedBottom({
        pinned: true,
        scrollTop: 80,
        lastScrollTop: 80,
        scrollHeight: 220,
        lastScrollHeight: 200,
        clientHeight: 100,
      }),
    ).toBe(true);
  });

  it("keeps prior pin when scrolling down mid-content", () => {
    expect(
      nextPinnedBottom({
        pinned: false,
        scrollTop: 60,
        lastScrollTop: 40,
        scrollHeight: 200,
        lastScrollHeight: 200,
        clientHeight: 100,
      }),
    ).toBe(false);
  });
});
