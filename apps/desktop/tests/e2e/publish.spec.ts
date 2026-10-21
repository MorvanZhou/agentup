import { expect, test } from "@playwright/test";

import { openOwnedAgents, openPublishNew, pickAgentAvatar, signIn } from "./helpers";
import { installRuntime } from "./runtime";

test("用共用表单发布 Agent 并支持只改名片", async ({ page }) => {
  await installRuntime(page);
  await signIn(page);
  await openOwnedAgents(page);
  await expect(page).toHaveURL(/\/agents\/owned$/);
  await expect(page.getByRole("heading", { name: "我发布的" })).toBeVisible();

  await page.getByRole("link", { name: "发布 Agent" }).click();
  await expect(page).toHaveURL(/\/agents\/owned\/new$/);
  await expect(page.getByRole("heading", { name: "发布 Agent" })).toBeVisible();

  await pickAgentAvatar(page);
  await page.getByLabel("名字").fill("写作助手");
  await page.getByLabel("它是干什么的").fill("编辑");
  await page.getByLabel("人物背景").fill("把零散想法整理成清楚的文字。");

  const created = page.waitForRequest(
    (request) => request.url().endsWith("/runtime/agents/local") && request.method() === "POST",
  );
  const published = page.waitForRequest((request) => request.url().endsWith("/runtime/agents/publish"));
  await page.getByRole("button", { name: "发布 Agent" }).click();
  expect((await created).postDataJSON()).toMatchObject({
    name: "写作助手",
    role: "编辑",
    background: "把零散想法整理成清楚的文字。",
  });
  expect((await published).postDataJSON()).toMatchObject({
    name: "写作助手",
    role: "编辑",
    background: "把零散想法整理成清楚的文字。",
  });
  await expect(page).toHaveURL(/\/agents\/owned$/);
  await expect(page.getByRole("article").filter({ hasText: "写作助手" })).toBeVisible();

  await page.getByRole("link", { name: "市场" }).click();
  await expect(page.getByRole("article").filter({ hasText: "写作助手" })).toBeVisible();
  await openOwnedAgents(page);

  await page.getByRole("link", { name: "更新 写作助手" }).click();
  await expect(page).toHaveURL(/\/agents\/owned\/writer$/);
  await expect(page.getByRole("heading", { name: "更新 Agent" })).toBeVisible();
  await expect(page.getByLabel("名字")).toHaveValue("写作助手");
  await expect(page.getByLabel("它是干什么的")).toHaveValue("编辑");

  await page.getByLabel("名字").fill("写作助手 Pro");
  // 只改名片走 PUT /card，不升版本。
  const cardUpdated = page.waitForRequest(
    (request) => request.url().endsWith("/runtime/agents/writer/card") && request.method() === "PUT",
  );
  await page.getByRole("button", { name: "保存并发布" }).click();
  expect((await cardUpdated).postDataJSON()).toMatchObject({
    name: "写作助手 Pro",
  });
  await expect(page).toHaveURL(/\/agents\/owned$/);
  await expect(page.getByRole("article").filter({ hasText: "写作助手 Pro" })).toContainText("v1");
});

test("发布所有权冲突会显示 backend 错误", async ({ page }) => {
  await installRuntime(page, { publishError: "不是这个 Agent 的发布者" });
  await signIn(page);
  await openPublishNew(page);
  await expect(page).toHaveURL(/\/agents\/owned\/new$/);
  await pickAgentAvatar(page);
  await page.getByLabel("名字").fill("写作助手");
  await page.getByLabel("它是干什么的").fill("编辑");
  await page.getByLabel("人物背景").fill("把零散想法整理成清楚的文字。");
  await page.getByRole("button", { name: "发布 Agent" }).click();
  await expect(page.getByRole("alert")).toHaveText("不是这个 Agent 的发布者");
});

test("名称岗位背景是发布硬条件", async ({ page }) => {
  await installRuntime(page);
  await signIn(page);
  await openPublishNew(page);

  const publish = page.getByRole("button", { name: "发布 Agent" });
  await expect(publish).toBeDisabled();
  await page.getByLabel("人物背景").fill("把零散想法整理成清楚的文字。");
  await expect(publish).toBeDisabled();
  await page.getByLabel("名字").fill("写作助手");
  await expect(publish).toBeDisabled();
  await page.getByLabel("它是干什么的").fill("编辑");
  await expect(publish).toBeEnabled();
});

test("运行包校验失败会显示详情", async ({ page }) => {
  await page.setViewportSize({ width: 730, height: 620 });
  await installRuntime(page, {
    inspectError: {
      error: "运行包校验失败",
      details: [
        { path: "SYSTEM.md", message: "缺少非空 SYSTEM.md" },
        { path: "skills/weather/SKILL.md", message: "description 不能为空" },
      ],
    },
  });
  await signIn(page);
  await openPublishNew(page);
  await pickAgentAvatar(page);
  await page.getByLabel("名字").fill("写作助手");
  await page.getByLabel("它是干什么的").fill("编辑");
  await page.getByLabel("人物背景").fill("把零散想法整理成清楚的文字。");
  await page.getByRole("button", { name: "发布 Agent" }).click();

  const dialog = page.getByRole("dialog", { name: "运行包校验失败" });
  await expect(dialog).toContainText("SYSTEM.md");
  await expect(dialog).toContainText("skills/weather/SKILL.md");
  await expect(dialog).toContainText("description 不能为空");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
