import { expect, it } from "vitest";

import { formatElapsedMs } from "../../src/pages/conversation/model/message/elapsed.js";

it("formats sub-second and second buckets", () => {
  expect(formatElapsedMs(0)).toBe("<1s");
  expect(formatElapsedMs(999)).toBe("<1s");
  expect(formatElapsedMs(1000)).toBe("1.0s");
  expect(formatElapsedMs(1500)).toBe("1.5s");
  expect(formatElapsedMs(10_000)).toBe("10s");
  expect(formatElapsedMs(65_000)).toBe("1m 5s");
});
