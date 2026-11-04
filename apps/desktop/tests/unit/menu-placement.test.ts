import { expect, it } from "vitest";

import { resolveMenuPlacement } from "../../src/shared/model/ui/menu-placement";

it("下方空间足够偏好高度时往下开，限高取偏好上限", () => {
  // 视口 800；触发器顶 100 底 136 → 下方约 800-136-4-8=652
  const result = resolveMenuPlacement({
    triggerTop: 100,
    triggerBottom: 136,
    viewportHeight: 800,
    preferredMaxHeight: 256,
  });
  expect(result).toEqual({ placement: "below", maxHeightPx: 256 });
});

it("贴底且上方更宽时翻转到上面，限高吃上方可用高度", () => {
  // 视口 600；触发器顶 500 底 536 → 下方 52，上方 488
  const result = resolveMenuPlacement({
    triggerTop: 500,
    triggerBottom: 536,
    viewportHeight: 600,
    gap: 4,
    edgePadding: 8,
    preferredMaxHeight: 256,
  });
  expect(result.placement).toBe("above");
  expect(result.maxHeightPx).toBe(256);
});

it("两侧都不够偏好高度时，选更宽的一侧并按实有高度限高", () => {
  // 视口 400；触发器顶 280 底 316 → 下方 72，上方 268
  const result = resolveMenuPlacement({
    triggerTop: 280,
    triggerBottom: 316,
    viewportHeight: 400,
    preferredMaxHeight: 256,
  });
  expect(result.placement).toBe("above");
  // 上方：280 - 4 - 8 = 268，但偏好 256 → 256
  expect(result.maxHeightPx).toBe(256);
});

it("下方更宽但不足偏好时仍往下，限高为下方可用高度", () => {
  // 视口 400；触发器顶 40 底 76 → 下方 312，上方 28；下方够偏好
  const cramped = resolveMenuPlacement({
    triggerTop: 200,
    triggerBottom: 236,
    viewportHeight: 400,
    preferredMaxHeight: 256,
  });
  // 下方：400-236-4-8=152；上方：200-4-8=188 → 上方更宽，翻转
  expect(cramped.placement).toBe("above");
  expect(cramped.maxHeightPx).toBe(188);

  const belowWider = resolveMenuPlacement({
    triggerTop: 120,
    triggerBottom: 156,
    viewportHeight: 400,
    preferredMaxHeight: 256,
  });
  // 下方：400-156-4-8=232；上方：120-4-8=108 → 往下，限 232
  expect(belowWider.placement).toBe("below");
  expect(belowWider.maxHeightPx).toBe(232);
});
