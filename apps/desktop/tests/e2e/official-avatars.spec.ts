import { expect, test, type Page } from "./page-faults";

import { pickAgentAvatar, signIn } from "./helpers";
import { installRuntime } from "./runtime";

const FIRST_PAGE = ["接待", "厨师", "学者", "夜猫", "乐手"];

async function openLocalCreate(page: Page): Promise<void> {
  await installRuntime(page);
  await signIn(page);
  await page.getByRole("link", { name: "Agents" }).click();
  await page.getByRole("link", { name: "新建" }).click();
  await expect(page.getByRole("heading", { name: "新建本机助手" })).toBeVisible();
}

test("官方头像一次只显示一排，左右翻页可以绕回", async ({ page }) => {
  await openLocalCreate(page);

  const options = page.getByRole("option");
  await expect(options).toHaveCount(5);
  await expect(options).toHaveText(FIRST_PAGE);

  await page.getByRole("button", { name: "下一页头像" }).click();
  await expect(options).toHaveCount(5);
  await expect(page.getByRole("option", { name: "接待" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "侦探" })).toBeVisible();

  await page.getByRole("button", { name: "上一页头像" }).click();
  await expect(options).toHaveText(FIRST_PAGE);

  await page.getByRole("button", { name: "上一页头像" }).click();
  await expect(page.getByRole("option", { name: "礼宾" })).toBeVisible();
  await expect(page.getByRole("option", { name: "接待" })).toHaveCount(0);

  await page.getByRole("button", { name: "下一页头像" }).click();
  await expect(options).toHaveText(FIRST_PAGE);
});

test("点选官方头像后可以再上传自己的图", async ({ page }) => {
  await openLocalCreate(page);

  await page.getByRole("option", { name: "厨师" }).click();
  const chef = page.getByRole("option", { name: "厨师" });
  await expect(chef).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "A" }).locator("img")).toHaveAttribute("src", /^data:image\//);
  await expect(page.getByRole("button", { name: "更换头像" })).toBeVisible();

  await pickAgentAvatar(page);
  await expect(chef).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("button", { name: "A" }).locator("img")).toHaveAttribute("src", /^data:image\//);
});

test("用官方头像创建本机助手时会提交图片", async ({ page }) => {
  await openLocalCreate(page);
  await page.getByRole("option", { name: "厨师" }).click();
  await expect(page.getByRole("option", { name: "厨师" })).toHaveAttribute("aria-selected", "true");

  await page.getByLabel("名字").fill("小厨");
  await page.getByLabel("它是干什么的").fill("做饭");
  await page.getByLabel("人物背景").fill("按菜谱做一桌菜。");

  const created = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/agents/local"),
  );
  await page.getByRole("button", { name: "创建并开始聊天" }).click();
  const body = (await created).postDataJSON() as { avatar_data_url?: string; name?: string };
  expect(body.name).toBe("小厨");
  expect(body.avatar_data_url).toMatch(/^data:image\//);
});

test("私人助理保存官方头像时会提交图片", async ({ page }) => {
  await installRuntime(page);
  await signIn(page);
  await page.getByRole("link", { name: "Agents" }).click();
  await page.getByRole("link", { name: "我的助理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我的助理", exact: true })).toBeVisible();

  await page.getByRole("option", { name: "接待" }).click();
  await expect(page.getByRole("option", { name: "接待" })).toHaveAttribute("aria-selected", "true");

  const saved = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && new URL(request.url()).pathname.endsWith("/personal-assistant/profile"),
  );
  await page.getByRole("button", { name: "保存" }).click();
  const body = (await saved).postDataJSON() as { avatar_data_url?: string; name?: string };
  expect(body.name).toBe("小A");
  expect(body.avatar_data_url).toMatch(/^data:image\//);
});
