import { expect, test } from "@playwright/test";

import { startAgent, signIn } from "./helpers";
import { installRuntime } from "./runtime";

test("单题 ask_user：可选选项并提交答案", async ({ page }) => {
  await installRuntime(page, { prompt: "ask-user" });
  await signIn(page);
  await startAgent(page, "呼吸科医生");
  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("帮我选数据库");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByText("AskUser").first()).toBeVisible();
  const dock = page.getByRole("region", { name: "需要你的回答" });
  await expect(dock).toBeVisible();
  await expect(dock.getByText("第 1/1 题 · 单选")).toBeVisible();
  await expect(dock.getByRole("heading", { name: "用哪个数据库？" })).toBeVisible();

  const decision = page.waitForRequest((request) =>
    request.url().includes("/runtime/ask-user/ask-user-respiratory-doctor"),
  );
  await dock.getByRole("option", { name: /Postgres/ }).click();
  await page.getByRole("button", { name: "提交" }).click();
  expect((await decision).postDataJSON()).toEqual({
    answer: {
      kind: "answers",
      items: [{ kind: "selection", selections: ["Postgres"] }],
    },
  });
  await expect(page.getByRole("heading", { name: "用哪个数据库？" })).toHaveCount(0);
});

test("多题 ask_user：进度、单选/多选切换与整批提交", async ({ page }) => {
  await installRuntime(page, { prompt: "ask-user-multi" });
  await signIn(page);
  await startAgent(page, "呼吸科医生");
  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("先确认几项偏好");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByText("第 1/2 题 · 单选")).toBeVisible();
  await expect(page.getByRole("button", { name: "下一题", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "切换到上一题" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "切换到下一题" })).toBeEnabled();

  await page.getByRole("button", { name: "切换到下一题" }).click();
  await expect(page.getByText("第 2/2 题 · 多选")).toBeVisible();
  await expect(page.getByRole("heading", { name: "需要哪些能力？" })).toBeVisible();
  await page.getByRole("button", { name: "切换到上一题" }).click();
  await expect(page.getByText("第 1/2 题 · 单选")).toBeVisible();

  await page.getByRole("option", { name: /SQLite/ }).click();
  await expect(page.getByText("第 2/2 题 · 多选")).toBeVisible();
  await expect(page.getByRole("heading", { name: "需要哪些能力？" })).toBeVisible();

  await page.getByRole("button", { name: "切换到上一题" }).click();
  await expect(page.getByText("第 1/2 题 · 单选")).toBeVisible();
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await expect(page.getByRole("heading", { name: "需要哪些能力？" })).toBeVisible();

  await page.getByRole("option", { name: /^搜索/ }).click();
  await page.getByRole("option", { name: /^联网/ }).click();

  const decision = page.waitForRequest((request) =>
    request.url().includes("/runtime/ask-user/ask-user-respiratory-doctor"),
  );
  await expect(page.getByRole("button", { name: "提交" })).toBeEnabled();
  await page.getByRole("button", { name: "提交" }).click();
  expect((await decision).postDataJSON()).toEqual({
    answer: {
      kind: "answers",
      items: [
        { kind: "selection", selections: ["SQLite"] },
        { kind: "selection", selections: ["搜索", "联网"] },
      ],
    },
  });
  await expect(page.getByRole("heading", { name: "需要哪些能力？" })).toHaveCount(0);
});

test("停止回复后 ask_user 浮层收起并显示已终止", async ({ page }) => {
  await installRuntime(page, { prompt: "ask-user" });
  await signIn(page);
  await startAgent(page, "呼吸科医生");
  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("帮我选数据库");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByRole("heading", { name: "用哪个数据库？" })).toBeVisible();
  // AskUser 等待时 isRunning 可能已是 false，仍应显示停止
  await expect(page.getByRole("button", { name: "停止回复" })).toBeVisible();
  await page.getByRole("button", { name: "停止回复" }).click();

  await expect(page.getByRole("heading", { name: "用哪个数据库？" })).toHaveCount(0);
  await expect(page.getByText("已终止").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
});

test("新对话后 ask_user 浮层收起", async ({ page }) => {
  await installRuntime(page, { prompt: "ask-user" });
  await signIn(page);
  await startAgent(page, "呼吸科医生");
  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("帮我选数据库");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByRole("heading", { name: "用哪个数据库？" })).toBeVisible();
  await page.getByRole("button", { name: "新对话" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "新对话" })).toBeVisible();
  const cleared = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes("/runtime/agents/respiratory-doctor/context"),
  );
  await dialog.getByRole("button", { name: "新对话" }).click();
  await cleared;
  await expect(page.getByRole("heading", { name: "用哪个数据库？" })).toHaveCount(0);
});

test("ask_user 可在底部自己输入并提交", async ({ page }) => {
  await installRuntime(page, { prompt: "ask-user" });
  await signIn(page);
  await startAgent(page, "呼吸科医生");
  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("自定义答案");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByRole("heading", { name: "用哪个数据库？" })).toBeVisible();
  await page.getByLabel("自己输入").fill("DuckDB");
  const decision = page.waitForRequest((request) =>
    request.url().includes("/runtime/ask-user/ask-user-respiratory-doctor"),
  );
  await page.getByRole("button", { name: "提交" }).click();
  expect((await decision).postDataJSON()).toEqual({
    answer: {
      kind: "answers",
      items: [{ kind: "freeform", text: "DuckDB" }],
    },
  });
});
