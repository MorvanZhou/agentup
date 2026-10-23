import { expect, test } from "@playwright/test";

import { mockAgentUp, signIn } from "./helpers";
import { installRuntime } from "./runtime";

test("无正式账号时打开应用进入主界面（游客）", async ({ page }) => {
  await installRuntime(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "账号：游客" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^小A/ })).toBeVisible();
});

test("尚无第三方招募时侧栏引导去市场，点击进入 Agent 市场", async ({ page }) => {
  await installRuntime(page);
  await page.goto("/");
  await expect(page.getByText("还没有招募其他 Agent 助手")).toBeVisible();
  await page.getByRole("button", { name: "去 Agent 市场" }).click();
  await expect(page).toHaveURL(/\/agents/);
  await expect(page.getByRole("heading", { name: "Agent 市场" })).toBeVisible();
});

test("尚无第三方招募时侧栏可引导添加本地 Agent", async ({ page }) => {
  await installRuntime(page);
  await page.goto("/");
  await expect(page.getByText("还没有招募其他 Agent 助手")).toBeVisible();
  await page.getByRole("button", { name: "添加本地 Agent" }).click();
  await expect(page).toHaveURL(/\/agents\/local\/new/);
});

test("已有第三方招募时侧栏不展示市场引导", async ({ page }) => {
  await installRuntime(page, { recruited: ["weather"] });
  await signIn(page);
  await expect(page.getByRole("button", { name: /^Weaty/ })).toBeVisible();
  await expect(page.getByText("还没有招募其他 Agent 助手")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "去 Agent 市场" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "添加本地 Agent" })).toHaveCount(0);
});

test("游客配置模型后可直接发送，不进入登录页", async ({ page }) => {
  await installRuntime(page);
  await page.goto("/");
  const prompt = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/runtime/personal-assistant/prompt"),
  );
  await page.getByRole("textbox", { name: /^发送消息/ }).fill("整理今天的计划");
  await page.getByRole("button", { name: "发送" }).click();
  expect((await prompt).postDataJSON()).toMatchObject({ user_id: "guest" });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "账号：游客" })).toBeVisible();
  await expect(page.getByText("整理今天的计划")).toBeVisible();
  await expect(page.getByRole("list").getByText("你好", { exact: true })).toBeVisible();
});

test("游客招募市场 Agent 会叠层引导登录，成功后继续招募", async ({ page }) => {
  await mockAgentUp(page);
  await page.addInitScript(() => {
    const bridge = window.agentUp;
    if (!bridge) return;
    let release: ((value: { code: string }) => void) | undefined;
    (window as Window & { releaseOAuth?: () => void }).releaseOAuth = () => {
      release?.({ code: "mock-oauth-code" });
    };
    bridge.oauthLoopbackWait = () =>
      new Promise<{ code: string }>((resolve) => {
        release = resolve;
      });
  });
  await installRuntime(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Agent 市场" }).click();
  const card = page.getByRole("article").filter({ hasText: "呼吸科医生" });
  const recruited = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/respiratory-doctor/recruit"),
  );
  await card.getByRole("button", { name: "招募" }).click();
  const dialog = page.getByRole("dialog", { name: "需要登录" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/agents/);
  await dialog.getByRole("button", { name: "去登录" }).click();
  await expect(dialog.getByRole("button", { name: "重新打开浏览器" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "取消" })).toBeEnabled();
  await page.evaluate(() => (window as Window & { releaseOAuth?: () => void }).releaseOAuth?.());
  await recruited;
  await expect(card.getByText("已招募")).toBeVisible();
  await expect(page.getByRole("button", { name: "账号：patient-a" })).toBeVisible();
});

test("浏览器登录：loopback mock 后进入私人助理会话", async ({ page }) => {
  await mockAgentUp(page);
  await installRuntime(page);
  await page.goto("/login");
  const exchange = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/runtime/auth/oauth/exchange"),
  );
  await page.getByRole("button", { name: "前往 agentup.me" }).click();
  const body = (await exchange).postDataJSON() as { code?: string };
  expect(body.code).toBe("mock-oauth-code");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "账号：patient-a" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^发送消息/ })).toBeEnabled();
});

test("等待浏览器登录时可重新打开或取消", async ({ page }) => {
  await mockAgentUp(page);
  await page.addInitScript(() => {
    const bridge = window.agentUp;
    if (!bridge) return;
    let release: ((value: { code: string }) => void) | undefined;
    let rejectWait: ((reason: Error) => void) | undefined;
    const opened: string[] = [];
    (window as Window & { releaseOAuth?: () => void; openedExternals?: string[] }).releaseOAuth = () => {
      release?.({ code: "mock-oauth-code" });
    };
    (window as Window & { openedExternals?: string[] }).openedExternals = opened;
    bridge.openExternal = async (url) => {
      opened.push(url);
    };
    bridge.oauthLoopbackWait = () =>
      new Promise<{ code: string }>((resolve, reject) => {
        release = resolve;
        rejectWait = reject;
      });
    bridge.oauthLoopbackStop = async () => {
      rejectWait?.(new Error("已取消登录"));
    };
  });
  await installRuntime(page);
  await page.goto("/login");
  await page.getByRole("button", { name: "前往 agentup.me" }).click();
  await expect(page.getByRole("button", { name: "重新打开浏览器" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消" })).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => (window as Window & { openedExternals?: string[] }).openedExternals?.[0] ?? ""),
    )
    .toMatch(/\/zh\/login\?/);
  await page.getByRole("button", { name: "重新打开浏览器" }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => (window as Window & { openedExternals?: string[] }).openedExternals?.length ?? 0),
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("button", { name: "前往 agentup.me" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新打开浏览器" })).toHaveCount(0);
});

test("登录后刷新仍自动进入会话", async ({ page }) => {
  await mockAgentUp(page);
  await installRuntime(page);
  await signIn(page);
  await expect(page.getByRole("button", { name: "账号：patient-a" })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "账号：patient-a" })).toBeVisible();
});

test("登出后落回游客主界面，不进入登录页", async ({ page }) => {
  await mockAgentUp(page);
  await installRuntime(page);
  await signIn(page);
  await page.getByRole("button", { name: /^账号：/ }).click();
  await page.getByRole("menuitem", { name: "登出" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "账号：游客" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^小A/ })).toBeVisible();
});
