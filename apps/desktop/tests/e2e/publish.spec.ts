import { expect, test } from "@playwright/test";

import { mockDirectoryPicker, openOwnedAgents, openPublishNew, signIn } from "./helpers";
import { installRuntime } from "./runtime";

test("选择目录、预览并发布 Agent", async ({ page }) => {
  await mockDirectoryPicker(page);
  await installRuntime(page);
  await signIn(page);
  await openOwnedAgents(page);
  await expect(page).toHaveURL(/\/agents\?tab=owned$/);
  await expect(page.getByRole("heading", { name: "我发布的" })).toBeVisible();

  await page.getByRole("link", { name: "发布 Agent" }).click();
  await expect(page).toHaveURL(/\/publish\/new$/);

  const inspected = page.waitForRequest((request) => request.url().endsWith("/runtime/agents/inspect"));
  await page.getByLabel("名称").fill("写作助手");
  await page.getByLabel("岗位").fill("编辑");
  await page.getByLabel("简介").fill("把零散想法整理成清楚的文字。");
  await page.getByRole("button", { name: "上传 Agent 运行包" }).click();
  expect((await inspected).postDataJSON()).toEqual({ agent_dir: "/demo/writer/agent" });
  const submit = page.getByRole("region", { name: "提交发布" });
  await expect(submit).toContainText("写作助手");
  await expect(submit).toContainText("运行包已就绪");
  await expect(submit).toContainText("信息已齐，可以发布到市场。");

  const published = page.waitForRequest((request) => request.url().endsWith("/runtime/agents/publish"));
  await submit.getByRole("button", { name: "发布 Agent" }).click();
  expect((await published).postDataJSON()).toEqual({
    agent_dir: "/demo/writer/agent",
    name: "写作助手",
    role: "编辑",
    summary: "把零散想法整理成清楚的文字。",
  });
  await expect(page).toHaveURL(/\/agents\?tab=owned$/);
  await expect(page.getByRole("article").filter({ hasText: "写作助手" })).toBeVisible();

  await page.getByRole("link", { name: "Agent 市场" }).click();
  await page.getByRole("button", { name: "Agent 市场", exact: true }).click();
  await expect(page.getByRole("article").filter({ hasText: "写作助手" })).toBeVisible();
  await openOwnedAgents(page);

  await page.getByRole("link", { name: "更新 写作助手" }).click();
  await expect(page).toHaveURL(/\/publish\/writer$/);
  await expect(page.getByRole("heading", { name: "更新 Agent" })).toBeVisible();
  await expect(page.getByLabel("名称")).toHaveValue("写作助手");
  await expect(page.getByLabel("岗位")).toHaveValue("编辑");
  await page.getByRole("button", { name: "上传 Agent 运行包" }).click();
  const updated = page.waitForRequest((request) => request.url().endsWith("/runtime/agents/publish"));
  await page.getByRole("button", { name: "发布新版本" }).click();
  expect((await updated).postDataJSON()).toMatchObject({ agent_id: "writer", name: "写作助手" });
  await expect(page).toHaveURL(/\/agents\?tab=owned$/);
  await expect(page.getByRole("article").filter({ hasText: "写作助手" })).toContainText("v2");
});

test("发布所有权冲突会显示 backend 错误", async ({ page }) => {
  await mockDirectoryPicker(page);
  await installRuntime(page, { publishError: "不是这个 Agent 的发布者" });
  await signIn(page);
  await openPublishNew(page);
  await expect(page).toHaveURL(/\/publish\/new$/);
  await page.getByLabel("名称").fill("写作助手");
  await page.getByLabel("岗位").fill("编辑");
  await page.getByLabel("简介").fill("把零散想法整理成清楚的文字。");
  await page.getByRole("button", { name: "上传 Agent 运行包" }).click();
  await page.getByRole("button", { name: "发布 Agent" }).click();
  await expect(page.getByRole("alert")).toHaveText("不是这个 Agent 的发布者");
});

test("名称和已校验运行包是发布硬条件", async ({ page }) => {
  await mockDirectoryPicker(page);
  await installRuntime(page);
  await signIn(page);
  await openPublishNew(page);

  const publish = page.getByRole("button", { name: "发布 Agent" });
  await expect(publish).toBeDisabled();
  await page.getByLabel("简介").fill("把零散想法整理成清楚的文字。");
  await page.getByRole("button", { name: "上传 Agent 运行包" }).click();
  await expect(publish).toBeDisabled();
  await expect(page.getByRole("region", { name: "提交发布" })).toContainText("还需完善：名称、岗位");
  await page.getByLabel("名称").fill("写作助手");
  await expect(publish).toBeDisabled();
  await page.getByLabel("岗位").fill("编辑");
  await expect(publish).toBeEnabled();
});

test("运行包错误弹窗显示文件详情并恢复焦点", async ({ page }) => {
  await page.setViewportSize({ width: 730, height: 620 });
  await mockDirectoryPicker(page);
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

  const choose = page.getByRole("button", { name: "上传 Agent 运行包" });
  await choose.click();
  const dialog = page.getByRole("dialog", { name: "运行包校验失败" });
  await expect(dialog).toContainText("SYSTEM.md");
  await expect(dialog).toContainText("skills/weather/SKILL.md");
  await expect(dialog).toContainText("description 不能为空");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "重新选择目录" })).toBeFocused();
});
