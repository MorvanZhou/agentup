import { expect, test } from "./page-faults";

import { mockAgentUp, messagesNav, openMarket, signIn, signOut } from "./helpers";
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
  await expect(page).toHaveURL(/\/market/);
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
  await openMarket(page);
  const card = page.getByRole("article").filter({ hasText: "呼吸科医生" });
  const recruited = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/respiratory-doctor/recruit"),
  );
  await card.getByRole("button", { name: "招募" }).click();
  const dialog = page.getByRole("dialog", { name: "需要登录" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/market/);
  await dialog.getByRole("button", { name: "去登录" }).click();
  await expect(dialog.getByRole("button", { name: "重新打开浏览器" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "取消" })).toBeEnabled();
  await page.evaluate(() => (window as Window & { releaseOAuth?: () => void }).releaseOAuth?.());
  await recruited;
  await expect(card.getByLabel("已招")).toBeVisible();
  await expect(page.getByRole("button", { name: "账号：patient-a" })).toBeVisible();
});

test("游客冷启动打开发布页会回到会话并叠层", async ({ page }) => {
  await installRuntime(page);
  await page.goto("/agents/owned/new");
  await expect(page).toHaveURL((url) => url.pathname === "/");
  const dialog = page.getByRole("dialog", { name: "需要登录" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "账号：游客" })).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL((url) => url.pathname === "/");
});

test("账号菜单点登录直接打开 Web 登录页，留在当前页", async ({ page }) => {
  await mockAgentUp(page);
  await page.addInitScript(() => {
    const bridge = window.agentUp;
    if (!bridge) return;
    const opened: string[] = [];
    (window as Window & { openedExternals?: string[] }).openedExternals = opened;
    bridge.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  await installRuntime(page);
  await page.goto("/");
  await page.getByRole("button", { name: "账号：游客" }).click();
  await page.getByRole("menuitem", { name: "登录 / 注册" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect
    .poll(async () =>
      page.evaluate(() => (window as Window & { openedExternals?: string[] }).openedExternals?.[0] ?? ""),
    )
    .toMatch(/\/zh\/login\?/);
  await expect(page.getByRole("button", { name: "账号：patient-a" })).toBeVisible();
});

test("账号设置点登录直接打开 Web 登录页，留在账号页", async ({ page }) => {
  await mockAgentUp(page);
  await page.addInitScript(() => {
    const bridge = window.agentUp;
    if (!bridge) return;
    const opened: string[] = [];
    (window as Window & { openedExternals?: string[] }).openedExternals = opened;
    bridge.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  await installRuntime(page);
  await page.goto("/settings?section=account");
  await expect(page.getByRole("heading", { name: "账号设置" })).toBeVisible();
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await expect(page).toHaveURL(/\/settings\?section=account/);
  await expect
    .poll(async () =>
      page.evaluate(() => (window as Window & { openedExternals?: string[] }).openedExternals?.[0] ?? ""),
    )
    .toMatch(/\/zh\/login\?/);
  await expect(page.getByLabel("邮箱")).toBeVisible();
});

test("从菜单打开 Web 登录后可重新打开或取消等待", async ({ page }) => {
  await mockAgentUp(page);
  await page.addInitScript(() => {
    const bridge = window.agentUp;
    if (!bridge) return;
    let rejectWait: ((reason: Error) => void) | undefined;
    const opened: string[] = [];
    (window as Window & { openedExternals?: string[] }).openedExternals = opened;
    bridge.openExternal = async (url: string) => {
      opened.push(url);
    };
    bridge.oauthLoopbackWait = () =>
      new Promise<{ code: string }>((_resolve, reject) => {
        rejectWait = reject;
      });
    bridge.oauthLoopbackStop = async () => {
      rejectWait?.(new Error("已取消登录"));
    };
  });
  await installRuntime(page);
  await page.goto("/");
  await page.getByRole("button", { name: "账号：游客" }).click();
  await page.getByRole("menuitem", { name: "登录 / 注册" }).click();
  const dialog = page.getByRole("dialog", { name: "继续登录" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect
    .poll(async () =>
      page.evaluate(() => (window as Window & { openedExternals?: string[] }).openedExternals?.[0] ?? ""),
    )
    .toMatch(/\/zh\/login\?/);
  await dialog.getByRole("button", { name: "重新打开浏览器" }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => (window as Window & { openedExternals?: string[] }).openedExternals?.length ?? 0),
    )
    .toBeGreaterThanOrEqual(2);
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "账号：游客" })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
});

test("浏览器登录：菜单换票后进入私人助理会话", async ({ page }) => {
  await mockAgentUp(page);
  await installRuntime(page);
  await page.goto("/");
  const exchange = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/runtime/auth/oauth/exchange"),
  );
  await page.getByRole("button", { name: "账号：游客" }).click();
  await page.getByRole("menuitem", { name: "登录 / 注册" }).click();
  const body = (await exchange).postDataJSON() as { code?: string };
  expect(body.code).toBe("mock-oauth-code");
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.getByRole("button", { name: "账号：patient-a" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^发送消息/ })).toBeEnabled();
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
  await signOut(page);
  await messagesNav(page).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "账号：游客" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^小A/ })).toBeVisible();
});
