import { expect, it } from "vitest";

import {
  COMPOSER_INPUT_MIN_HEIGHT,
  clampComposerInputHeight,
  maxComposerInputHeight,
} from "../../src/pages/conversation/model/composer-height.js";

it("clamps composer input height to min and max", () => {
  expect(clampComposerInputHeight(40, 64, 200)).toBe(64);
  expect(clampComposerInputHeight(300, 64, 200)).toBe(200);
  expect(clampComposerInputHeight(120.4, 64, 200)).toBe(120);
  expect(clampComposerInputHeight(Number.NaN, 64, 200)).toBe(64);
});

it("caps max height at half the thread column", () => {
  expect(maxComposerInputHeight(100)).toBe(COMPOSER_INPUT_MIN_HEIGHT);
  expect(maxComposerInputHeight(800)).toBe(400);
});
