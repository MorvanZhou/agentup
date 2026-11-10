import { expect, test } from "./page-faults";

import {
  expectNoHorizontalOverflow,
  messagesNav,
  openMarket,
  openOwnedAgents,
  signIn,
} from "./helpers";
import { installRuntime } from "./runtime";

test("窄窗口里会话留在首屏，页面不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await installRuntime(page);
  await signIn(page);
  await expect(page.getByRole("button", { name: /^小A/ })).toBeInViewport();
  await expect(page.getByRole("textbox", { name: /^发送消息/ })).toBeInViewport();
  await expectNoHorizontalOverflow(page);

  await openMarket(page);
  await expect(page.getByRole("heading", { name: "Agent 市场" })).toBeInViewport();
  await openOwnedAgents(page);
  await expect(page).toHaveURL(/\/agents\/owned$/);
  await expect(page.getByRole("heading", { name: "我发布的" })).toBeVisible();
  await expect(page.getByRole("link", { name: "发布 Agent" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("link", { name: "设置" }).click();
  // 轨栏设置入口默认进 AI 服务配置（不再落通用）
  await expect(page).toHaveURL(/\/settings\?section=provider/);
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "可用模型" })).toBeVisible();
  // 窄窗下侧栏切分区仍不横溢
  await page.getByRole("button", { name: "通用" }).click();
  await expect(page.getByRole("heading", { name: "通用" })).toBeVisible();
  await page.getByRole("button", { name: "AI 服务配置" }).click();
  await expect(page.getByRole("heading", { name: "可用模型" })).toBeVisible();
  // 默认入口漏斗两卡；点本地后才见接入商 + SDK 主钮
  await expect(page.getByRole("button", { name: /接入本地 Agent 应用/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /接入 API 服务/ })).toBeVisible();
  await page.getByRole("button", { name: /接入本地 Agent 应用/ }).click();
  await expect(page.getByRole("button", { name: "接入商" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始接入" })).toBeVisible();
  await expect(messagesNav(page)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("730 宽窗口保留左侧栏并且主区域完整可用", async ({ page }) => {
  await page.setViewportSize({ width: 730, height: 620 });
  await installRuntime(page, { recruited: ["respiratory-doctor"] });
  await signIn(page);

  const main = await page.locator("main").boundingBox();
  expect(main?.x).toBeGreaterThanOrEqual(180);
  await expect(page.getByRole("button", { name: /^呼吸科医生/ })).toBeInViewport();
  await expect(page.getByRole("textbox", { name: /^发送消息/ })).toBeInViewport();
  await expectNoHorizontalOverflow(page);
});

test("可拖拽调整会话列表与工作空间宽度", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await installRuntime(page);
  await signIn(page);

  const sidebarHandle = page.getByRole("button", { name: "调整会话列表宽度" });
  const mainBefore = await page.locator("main").boundingBox();
  expect(mainBefore).toBeTruthy();
  const sidebarBox = await sidebarHandle.boundingBox();
  expect(sidebarBox).toBeTruthy();
  await page.mouse.move(sidebarBox!.x + sidebarBox!.width / 2, sidebarBox!.y + sidebarBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sidebarBox!.x + 80, sidebarBox!.y + sidebarBox!.height / 2, { steps: 6 });
  await page.mouse.up();
  const mainAfter = await page.locator("main").boundingBox();
  expect(mainAfter!.x).toBeGreaterThan((mainBefore!.x ?? 0) + 40);

  await page.getByRole("button", { name: "工作空间", exact: true }).click();
  // 右栏统一把手：工作区 / 设置 / 预览共用「调整侧栏宽度」
  const threadHandle = page.getByRole("button", { name: "调整侧栏宽度" });
  const workspace = page.locator("aside").filter({
    has: page.getByRole("navigation", { name: "工作空间分区" }),
  });
  const before = await workspace.boundingBox();
  expect(before).toBeTruthy();
  const handleBox = await threadHandle.boundingBox();
  expect(handleBox).toBeTruthy();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x - 100, handleBox!.y + handleBox!.height / 2, { steps: 6 });
  await page.mouse.up();
  const after = await workspace.boundingBox();
  expect(after!.width).toBeGreaterThan((before!.width ?? 0) + 40);
});
