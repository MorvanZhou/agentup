/** @vitest-environment happy-dom */
import { expect, it } from "vitest";

import { scrollTopForAnchor } from "../../src/pages/conversation/model/thread/thread-window.js";

/**
 * 切 tab 后气泡顶边下移（内容变矮被夹紧）时，应对齐回原顶边：
 * scrollTop 增加 (afterTop - beforeTop)。
 */
it("气泡顶边被拽下时 scrollTop 上调把锚点拉回", () => {
  expect(scrollTopForAnchor(1200, 80, 140)).toBe(1260);
});

/** 内容变高、stick-to-bottom 把顶边顶出视口时，scrollTop 下调。 */
it("气泡顶边上移出视口时 scrollTop 下调把锚点拉回", () => {
  expect(scrollTopForAnchor(1200, 80, 20)).toBe(1140);
});
