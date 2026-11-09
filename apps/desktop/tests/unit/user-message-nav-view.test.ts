/** @vitest-environment happy-dom */
import { expect, it } from "vitest";

import UserMessageNav from "../../src/pages/conversation/components/chat-main/shared/thread/UserMessageNav.vue";
import { mountView } from "./mount-view.js";

const threeItems = [
  { id: "u1", preview: "第一问天气", index: 0 },
  { id: "u2", preview: "第二问北京", index: 2 },
  { id: "u3", preview: "第三问广州", index: 4 },
];

it("挂载完整锚点列表：收起态只有标尺按钮，不提前露出预览文案", () => {
  const host = mountView(UserMessageNav, {
    props: {
      items: threeItems,
      activeId: "u2",
    },
  });

  expect(host.querySelector('[aria-label="用户消息导航"]')).toBeTruthy();
  expect(host.querySelectorAll("button")).toHaveLength(3);
  expect(host.textContent).not.toContain("第一问天气");
  expect(host.textContent).not.toContain("第二问北京");
  expect(document.body.querySelectorAll("button[data-nav-row]")).toHaveLength(0);
});

it("缺字段 / 空预览仍可挂载，不因空串抛错", () => {
  const host = mountView(UserMessageNav, {
    props: {
      items: [
        { id: "a", preview: "", index: 0 },
        { id: "b", preview: "有字", index: 1 },
        { id: "c", preview: "", index: 2 },
      ],
      activeId: null,
    },
  });
  expect(host.querySelector('[aria-label="用户消息导航"]')).toBeTruthy();
  expect(host.querySelectorAll("button")).toHaveLength(3);
});
