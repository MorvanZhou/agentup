import { expect, test } from "./page-faults";

import { messagesNav, mockAgentUp, openMarket, signIn } from "./helpers";
import { installRuntime } from "./runtime";

test("市场可按名称经 runtime 检索 Agent", async ({ page }) => {
  await mockAgentUp(page);
  await installRuntime(page);
  await signIn(page);
  await openMarket(page);
  await expect(page.getByRole("article")).toHaveCount(2);

  const searched = page.waitForRequest((request) => {
    if (request.method() !== "GET") return false;
    const url = new URL(request.url());
    return url.pathname.endsWith("/agents") && url.searchParams.get("q") === "天气";
  });
  await page.getByLabel("搜索 Agent").fill("天气");
  await searched;
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("Weaty");
  await expect(page.getByRole("article")).toContainText("气象员");

  const miss = page.waitForRequest((request) => {
    if (request.method() !== "GET") return false;
    const url = new URL(request.url());
    return url.pathname.endsWith("/agents") && url.searchParams.get("q") === "不存在的关键词";
  });
  await page.getByLabel("搜索 Agent").fill("不存在的关键词");
  await miss;
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByText("没有匹配的 Agent。")).toBeVisible();
});

test("市场列出 Agent，并能招募Weaty", async ({ page }) => {
  await installRuntime(page);
  await signIn(page, { recordOpenedVisit: true });
  await openMarket(page);

  await expect(page.getByRole("heading", { name: "Agent 市场" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  const weather = page.getByRole("article").filter({ hasText: "Weaty" });
  await expect(weather).toContainText("气象员");
  await expect(weather.getByLabel("0 次招募")).toBeVisible();
  await expect(weather.getByRole("button", { name: "管理 Weaty" })).toHaveCount(0);
  const synced = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/runtime/agents/weather/sync"),
  );
  await weather.getByRole("button", { name: "招募" }).click();
  expect((await synced).postDataJSON()).toEqual({ user_id: "patient-a" });
  await expect(weather.getByLabel("已招")).toBeVisible();
  await expect(weather.getByLabel("1 次招募")).toBeVisible();
  // 市场页只负责招募；开目录 / 解雇在 Agents → 已招募。
  await page.getByRole("link", { name: "Agents" }).click();
  await page.getByRole("link", { name: "已招募" }).click();
  const recruited = page.getByRole("article").filter({ hasText: "Weaty" });
  const opened = page.waitForRequest((request) => request.url().endsWith("/runtime/agents/weather/directory"));
  await recruited.getByRole("button", { name: "管理 Weaty" }).click();
  await page.getByRole("menuitem", { name: "打开工作目录" }).click();
  expect((await opened).postDataJSON()).toEqual({ user_id: "patient-a" });
  await expect.poll(() => page.evaluate(() => window.openedVisit)).toBe("/tmp/agentup/users/patient-a/agents/weather");

  await messagesNav(page).click();
  const conversation = page.getByRole("button", { name: "Weaty", exact: true });
  await expect(conversation).toBeVisible();
  await expect(conversation).toContainText("暂无消息");
});

test("招募后市场卡招募次数 +1，解雇再招不刷数", async ({ page }) => {
  await mockAgentUp(page);
  await installRuntime(page);
  await signIn(page);
  await openMarket(page);

  const weather = page.getByRole("article").filter({ hasText: "Weaty" });
  await expect(weather.getByLabel("0 次招募")).toBeVisible();
  await weather.getByRole("button", { name: "招募" }).click();
  await expect(weather.getByLabel("1 次招募")).toBeVisible();

  await page.getByRole("link", { name: "Agents" }).click();
  await page.getByRole("link", { name: "已招募" }).click();
  const recruited = page.getByRole("article").filter({ hasText: "Weaty" });
  await recruited.getByRole("button", { name: "管理 Weaty" }).click();
  await page.getByRole("menuitem", { name: "解雇" }).click();
  await page.getByRole("dialog", { name: "确认解雇这个 Agent？" }).getByRole("button", { name: "解雇" }).click();

  await openMarket(page);
  const marketCard = page.getByRole("article").filter({ hasText: "Weaty" });
  await expect(marketCard.getByRole("button", { name: "招募" })).toBeVisible();
  await expect(marketCard.getByLabel("1 次招募")).toBeVisible();

  await marketCard.getByRole("button", { name: "招募" }).click();
  await expect(marketCard.getByLabel("1 次招募")).toBeVisible();
  await expect(marketCard.getByLabel("已招")).toBeVisible();
});
