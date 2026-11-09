import { expect, test } from "./page-faults";

import { conversationItem, signIn } from "./helpers";
import { installRuntime } from "./runtime";

function turn(userId: string, userText: string, assistantId: string, assistantText: string) {
  return [
    { id: userId, role: "user" as const, parts: [{ type: "text" as const, text: userText }] },
    {
      id: assistantId,
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: assistantText, state: "done" as const }],
    },
  ];
}

/** 浮层清单跳转钮（收起态短横没有该 aria-label）。 */
function navJumpItems(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: "跳转到该条用户消息" });
}

test("不足 3 条 user 时不出现锚点导航，上下跳转仍可用", async ({ page }) => {
  await installRuntime(page, {
    recruited: ["weather"],
    history: {
      weather: [
        ...turn("u1", "只有第一问", "a1", "答一"),
        ...turn("u2", "只有第二问", "a2", "答二"),
      ],
    },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();
  await expect(page.getByText("只有第一问")).toBeVisible();
  await expect(page.getByText("只有第二问")).toBeVisible();

  await expect(page.getByRole("navigation", { name: "用户消息导航" })).toHaveCount(0);
  // 旧入口：上一条 user / 回底部仍在
  await expect(page.getByRole("button", { name: "跳转到上一条用户消息" })).toBeVisible();
  await expect(page.getByRole("button", { name: "跳转到最新消息" })).toBeVisible();
});

test("≥3 条 user 时出现锚点；hover 列出全部预览；点击跳到对应气泡；上下跳转仍在", async ({
  page,
}) => {
  await installRuntime(page, {
    recruited: ["weather"],
    history: {
      weather: [
        ...turn("u1", "第一问上海天气", "a1", "上海晴。"),
        ...turn("u2", "第二问北京天气", "a2", "北京多云。"),
        ...turn("u3", "第三问广州天气", "a3", "广州有雨。"),
      ],
    },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();
  await expect(page.getByText("第三问广州天气")).toBeVisible();

  const nav = page.getByRole("navigation", { name: "用户消息导航" });
  await expect(nav).toBeVisible();
  await expect(navJumpItems(page)).toHaveCount(0);

  // 悬停收起态短横打开气泡；再悬停浮层项，避免 pointerleave 把面板闪关
  await nav.locator("button").first().hover();
  const jumps = navJumpItems(page);
  await expect(jumps).toHaveCount(3);
  await jumps.first().hover();
  await expect(jumps.nth(0)).toContainText("第一问上海天气");
  await expect(jumps.nth(1)).toContainText("第二问北京天气");
  await expect(jumps.nth(2)).toContainText("第三问广州天气");

  await jumps.first().click();
  await expect(page.locator('[data-thread-message-id="u1"]')).toBeVisible();
  await expect(page.locator('[data-thread-message-id="u1"]')).toContainText("第一问上海天气");

  // 旧入口并存
  await expect(page.getByRole("button", { name: "跳转到上一条用户消息" })).toBeVisible();
  await expect(page.getByRole("button", { name: "跳转到最新消息" })).toBeVisible();
});
