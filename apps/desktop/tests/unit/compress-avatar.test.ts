import { expect, it } from "vitest";

import { AVATAR_MAX_EDGE, fitAvatarSize } from "../../src/shared/model/avatar/compress-avatar.js";

it("keeps small images unchanged", () => {
  expect(fitAvatarSize(128, 96)).toEqual({ width: 128, height: 96 });
});

it("scales down by longest edge", () => {
  expect(fitAvatarSize(1024, 512, AVATAR_MAX_EDGE)).toEqual({ width: 256, height: 128 });
  expect(fitAvatarSize(400, 800, AVATAR_MAX_EDGE)).toEqual({ width: 128, height: 256 });
});

it("rejects invalid dimensions", () => {
  expect(() => fitAvatarSize(0, 10)).toThrow("无效的图片尺寸");
  expect(() => fitAvatarSize(10, Number.NaN)).toThrow("无效的图片尺寸");
});
