import { expect, test } from "./page-faults";

import { conversationItem, signIn, syncAgent } from "./helpers";
import { installRuntime } from "./runtime";

test("当前计划停在输入区上方，不写进消息流", async ({ page }) => {
  await installRuntime(page, {
    recruited: ["weather"],
    history: {
      weather: [
        { id: "user-0", role: "user", parts: [{ type: "text", text: "帮我拆成待办" }] },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            { type: "reasoning", text: "先列计划", state: "done" },
            {
              type: "dynamic-tool",
              toolCallId: "todo-1",
              toolName: "todo",
              state: "output-available",
              input: { action: "add", text: "写测试" },
              output: "Added todo #2: 写测试\n[ ] #1: 读文件\n[x] #2: 写测试",
            },
            { type: "text", text: "计划已经记下。", state: "done" },
          ],
        },
      ],
    },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();

  const plan = page.getByRole("region", { name: "当前计划" });
  await expect(page.getByText("计划已经记下。")).toBeVisible();
  await expect(plan.locator("li").first()).toContainText("读文件");
  await expect(plan.locator("li").nth(1)).toContainText("写测试");
  await expect(plan.getByText("1/2")).toBeVisible();
  await expect(page.locator("ol").getByText("读文件")).toHaveCount(0);

  await page.getByRole("button", { name: "隐藏计划" }).click();
  await expect(plan).toHaveCount(0);
});

test("计划列表停在最新一条", async ({ page }) => {
  const lines = Array.from({ length: 12 }, (_, index) => `[ ] #${index + 1}: 步骤${index + 1}`).join("\n");
  await installRuntime(page, {
    recruited: ["weather"],
    history: {
      weather: [
        { id: "user-0", role: "user", parts: [{ type: "text", text: "拆成很多步" }] },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolCallId: "todo-1",
              toolName: "todo",
              state: "output-available",
              input: { action: "add", text: "步骤12" },
              output: lines,
            },
            { type: "text", text: "十二步都记下了。", state: "done" },
          ],
        },
      ],
    },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();

  const list = page.getByRole("region", { name: "当前计划" }).locator("ul");
  await expect(list.locator("li").first()).toContainText("步骤1");
  await expect(list.locator("li").last()).toContainText("步骤12");
  await expect
    .poll(() =>
      list.evaluate((node) => {
        const last = node.lastElementChild;
        if (!(last instanceof HTMLElement)) return false;
        const listRect = node.getBoundingClientRect();
        const itemRect = last.getBoundingClientRect();
        const latestVisible = itemRect.bottom <= listRect.bottom + 1 && itemRect.top >= listRect.top;
        const oldestAbove = (node.firstElementChild?.getBoundingClientRect().top ?? 0) < listRect.top;
        return latestVisible && oldestAbove;
      }),
    )
    .toBe(true);
});

test("计划全部完成后挂在助手消息下方，不再占底部", async ({ page }) => {
  await installRuntime(page, {
    recruited: ["weather"],
    history: {
      weather: [
        { id: "user-0", role: "user", parts: [{ type: "text", text: "做完了吗" }] },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolCallId: "todo-1",
              toolName: "todo",
              state: "output-available",
              input: { action: "toggle", id: 1 },
              output: "[x] #1: 读文件\n[x] #2: 写测试",
            },
            { type: "text", text: "都完成了。", state: "done" },
          ],
        },
      ],
    },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();
  await expect(page.getByText("都完成了。")).toBeVisible();
  await expect(page.getByRole("region", { name: "当前计划" })).toHaveCount(0);
  await page.getByRole("tab", { name: "待办" }).click();
  const result = page.getByRole("button", { name: "2/2 项已完成" });
  await expect(result).toBeVisible();
  const completed = page.getByRole("list", { name: "已完成待办" });
  // tab 内默认展开，列表已可见；再点可收起。
  await expect(completed.getByText("读文件")).toBeVisible();
  await expect(completed.getByText("写测试")).toBeVisible();
  await result.click();
  await expect(completed).toHaveCount(0);
});

test("提问出现时计划让出底部，结束后再回来", async ({ page }) => {
  await installRuntime(page, {
    prompt: "ask-user",
    recruited: ["weather"],
    history: {
      weather: [
        { id: "user-0", role: "user", parts: [{ type: "text", text: "帮我拆成待办" }] },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolCallId: "todo-1",
              toolName: "todo",
              state: "output-available",
              input: { action: "add", text: "写测试" },
              output: "[ ] #1: 读文件",
            },
            { type: "text", text: "计划已经记下。", state: "done" },
          ],
        },
      ],
    },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();
  await expect(page.getByRole("region", { name: "当前计划" })).toBeVisible();

  await syncAgent(page, "Weaty");
  await page.getByRole("textbox", { name: /^发送消息/ }).fill("先问我一下");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByRole("heading", { name: "用哪个数据库？" })).toBeVisible();
  await expect(page.getByRole("region", { name: "当前计划" })).toHaveCount(0);

  await page.getByRole("button", { name: "关闭提问" }).click();
  await expect(page.getByRole("heading", { name: "用哪个数据库？" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "当前计划" }).getByText("读文件")).toBeVisible();
});

test("后续消息把原回复顶出窗口后，计划仍停在输入区上方", async ({ page }) => {
  const later = Array.from({ length: 20 }, (_, index) => [
    {
      id: `user-${index + 1}`,
      role: "user",
      parts: [{ type: "text", text: `后续 ${index}` }],
    },
    {
      id: `assistant-later-${index + 1}`,
      role: "assistant",
      parts: [{ type: "text", text: `收到后续 ${index}`, state: "done" }],
    },
  ]).flat();
  await installRuntime(page, {
    recruited: ["weather"],
    history: {
      weather: [
        { id: "user-0", role: "user", parts: [{ type: "text", text: "帮我拆成待办" }] },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolCallId: "todo-1",
              toolName: "todo",
              state: "output-available",
              input: { action: "add", text: "写测试" },
              output: "[ ] #1: 读文件\n[x] #2: 写测试",
            },
            { type: "text", text: "计划已经记下。", state: "done" },
          ],
        },
        ...later,
      ],
    },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();

  const plan = page.getByRole("region", { name: "当前计划" });
  await expect(plan.getByText("读文件")).toBeVisible();
  await expect(plan.getByText("1/2")).toBeVisible();
  await expect(page.getByText("计划已经记下。")).toHaveCount(0);
  await expect(page.getByText("收到后续 19")).toBeVisible();
});
