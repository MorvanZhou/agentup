/**
 * @vitest-environment happy-dom
 */
import { expect, it } from "vitest";

import ComputerActionBody from "../../src/pages/conversation/components/chat-main/shared/thread/assistant-ui/tools/computer/ComputerActionBody.vue";
import { mountView } from "./mount-view.js";

/** 1×1 透明 PNG，挂载测不依赖真实截图文件。 */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

it("有图时画出截图，不铺 fallback 短文", () => {
  const host = mountView(ComputerActionBody, {
    props: {
      images: [{ mimeType: "image/png", src: `data:image/png;base64,${TINY_PNG}` }],
      marker: { x: 0.25, y: 0.5 },
      fallbackText: "should-not-show AX tree dump",
    },
  });
  expect(host.querySelector("img")).toBeTruthy();
  expect(host.textContent).not.toContain("should-not-show");
});

it("无图时只画折叠短文，不抛渲染错", () => {
  const host = mountView(ComputerActionBody, {
    props: {
      images: [],
      fallbackText: "Calculator · #14 role=button",
    },
  });
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toContain("Calculator · #14");
});
