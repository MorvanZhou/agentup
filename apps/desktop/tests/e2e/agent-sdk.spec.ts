import { expect, test } from "./page-faults";

import { messagesNav, openUserMenu, signIn, startAgent } from "./helpers";
import { installRuntime } from "./runtime";

/** 设置 → AI 服务配置，并等到目录拉齐。 */
async function openProviderSettings(
  page: Parameters<typeof signIn>[0],
): Promise<void> {
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "设置" }).click();
  const loaded = page.waitForResponse((response) => {
    if (response.request().method() !== "GET") return false;
    return new URL(response.url()).pathname.endsWith("/settings/provider");
  });
  await page.getByRole("button", { name: "AI 服务配置" }).click();
  await loaded;
  await expect(page.getByRole("heading", { name: "可用模型" })).toBeVisible();
}

/** 已有 API 连接时「连接服务商」默认折叠，先摊开再操作接入下拉。 */
async function expandProviderConnect(page: Parameters<typeof signIn>[0]): Promise<void> {
  const trigger = page.getByRole("button", { name: "接入方式" });
  if (await trigger.isVisible().catch(() => false)) return;
  await page.getByText("连接或修改服务商", { exact: true }).click();
  await expect(trigger).toBeVisible();
}

/** 接入方式下拉：选本地 Agent App（Workbuddy / CodeBuddy）。 */
async function selectLocalAgentApp(page: Parameters<typeof signIn>[0]): Promise<void> {
  await expandProviderConnect(page);
  await page.getByRole("button", { name: "接入方式" }).click();
  await expect(page.getByRole("presentation").filter({ hasText: "本地 Agent App 接入" })).toBeVisible();
  await page.getByRole("option", { name: /Workbuddy \/ CodeBuddy/ }).click();
}

/**
 * 本地 Agent App（SDK）产品面回归：设置态机 + 信任说明 + 旧 API Key 路径仍在。
 * 细契约（canUseTool / context / skills 投影）仍靠 runtime L0；对话排队见 follow-up.spec。
 */
test("下拉分两组：选本地 App 见信任说明，切回 API Key 仍能改 Ollama", async ({ page }) => {
  await installRuntime(page);
  await signIn(page);
  await openProviderSettings(page);
  await expandProviderConnect(page);

  await page.getByRole("button", { name: "接入方式" }).click();
  await expect(page.getByRole("presentation").filter({ hasText: "API Key 接入" })).toBeVisible();
  await expect(page.getByRole("presentation").filter({ hasText: "本地 Agent App 接入" })).toBeVisible();
  // Codex 与 CodeBuddy 同组出现（新接入厂商入口回归）
  await expect(page.getByRole("option", { name: /^Codex/ })).toBeVisible();
  await page.getByRole("option", { name: /Workbuddy \/ CodeBuddy/ }).click();

  await expect(page.getByRole("note")).toContainText("信任模式");
  await expect(page.getByRole("note")).toContainText("Workbuddy / CodeBuddy");
  await expect(page.getByRole("button", { name: "开始接入" })).toBeVisible();
  await expect(page.getByText("未安装", { exact: true })).toBeVisible();

  // 旧路径：切回 API Key 组的 Ollama，表单仍是地址 + 保存（不要被 SDK 卡片顶掉）
  await page.getByRole("button", { name: "接入方式" }).click();
  await page.getByRole("option", { name: /^Ollama/ }).click();
  await expect(page.getByLabel("服务地址")).toBeVisible();
  // 已有连接时主按钮是「更新配置」（新建才是「保存连接」）
  await expect(page.getByRole("button", { name: "更新配置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始接入" })).toHaveCount(0);
});

test("选 Codex：见信任说明与开始接入（入口在本地 App 组）", async ({ page }) => {
  await installRuntime(page);
  await signIn(page);
  await openProviderSettings(page);
  await expandProviderConnect(page);
  await page.getByRole("button", { name: "接入方式" }).click();
  await page.getByRole("option", { name: /^Codex/ }).click();
  await expect(page.getByRole("note")).toContainText("信任模式");
  await expect(page.getByRole("note")).toContainText("Codex");
  await expect(page.getByRole("button", { name: "开始接入" })).toBeVisible();
  await expect(page.getByText("未安装", { exact: true })).toBeVisible();
});

test("安装 → 浏览器登录 → 可用：模型进列表，可启用并在会话里选中", async ({ page }) => {
  await installRuntime(page);
  await signIn(page);
  await openProviderSettings(page);
  await selectLocalAgentApp(page);

  const installStarted = page.waitForRequest((request) => {
    if (request.method() !== "POST") return false;
    return new URL(request.url()).pathname.endsWith("/settings/provider/agents/codebuddy-sdk/install");
  });
  await page.getByRole("button", { name: "开始接入" }).click();
  await installStarted;
  // toast 与接入进度都是 role=status；裸 getByRole 会跟「安装中/登录中」撞 strict mode
  await expect(page.getByRole("status").filter({ hasText: "接入完成" })).toBeVisible();
  await expect(page.getByText("未登录", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
  // 登录前选站点：中文界面默认中国站；点国际站再登录，请求要带 environment
  await expect(page.getByRole("radiogroup", { name: "登录站点" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "中国站" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "国际站" }).click();

  const loginStarted = page.waitForRequest((request) => {
    if (request.method() !== "POST") return false;
    if (!new URL(request.url()).pathname.endsWith("/settings/provider/agents/codebuddy-sdk/login")) {
      return false;
    }
    const body = request.postDataJSON() as { environment?: string };
    return body.environment === "external";
  });
  // 轮询落 ready 的那一下；先挂上再点，避免快路径漏等
  const loginChecked = page.waitForResponse((response) => {
    if (response.request().method() !== "POST") return false;
    return new URL(response.url()).pathname.endsWith(
      "/settings/provider/agents/codebuddy-sdk/login-check",
    );
  });
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await loginStarted;
  await expect
    .poll(async () => page.evaluate(() => (window as { openedExternal?: string }).openedExternal ?? ""))
    .toBe("https://example.com/codebuddy-login");
  await loginChecked;
  // 产品态优先；toast「已登录」同样要 filter，避免与进度「登录中」并存时 strict 误伤
  await expect(page.getByText("可用", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "已登录" })).toBeVisible();
  await expect(page.getByText("账号 mock-sdk-user")).toBeVisible();
  // exact：同名 modelId（claude-sonnet-5）也会被不区分大小写的 getByText 命中
  await expect(page.getByText("Claude-Sonnet-5", { exact: true })).toBeVisible();
  await expect(page.getByText("1.33x")).toBeVisible();

  const enabled = page.waitForRequest((request) => {
    if (request.method() !== "POST") return false;
    if (!new URL(request.url()).pathname.endsWith("/settings/provider/models/enabled")) return false;
    const body = request.postDataJSON() as {
      template_id?: string;
      model_id?: string;
      enabled?: boolean;
    };
    return (
      body.template_id === "codebuddy-sdk" &&
      body.model_id === "claude-sonnet-5" &&
      body.enabled === true
    );
  });
  await page.getByRole("switch", { name: "启用 Claude-Sonnet-5" }).click();
  await enabled;

  // 卡片主按钮在 ready 后变成「刷新模型」
  const refreshed = page.waitForRequest((request) => {
    if (request.method() !== "POST") return false;
    return new URL(request.url()).pathname.endsWith("/settings/provider/agents/codebuddy-sdk/models");
  });
  await page.getByRole("button", { name: "刷新模型" }).first().click();
  await refreshed;
  await expect(page.getByText("Claude-Opus-4", { exact: true })).toBeVisible();

  await messagesNav(page).click();
  await startAgent(page, "呼吸科医生");
  await page.getByRole("button", { name: "选择本会话使用的模型" }).click();
  const picked = page.waitForRequest((request) => {
    if (request.method() !== "PUT") return false;
    if (!request.url().includes("/session/model")) return false;
    const body = request.postDataJSON() as { template_id?: string; model_id?: string };
    return body.template_id === "codebuddy-sdk" && body.model_id === "claude-sonnet-5";
  });
  await page.getByRole("option", { name: /Claude-Sonnet-5/ }).click();
  await picked;
  await expect(page.getByRole("button", { name: "选择本会话使用的模型" })).toContainText(
    "Claude-Sonnet-5",
  );
});

test("登出清登录态与模型，卸载回到未安装", async ({ page }) => {
  await installRuntime(page);
  await signIn(page);
  await openProviderSettings(page);
  await selectLocalAgentApp(page);

  // 先走到 ready（与上条同一 mock 状态机）
  await page.getByRole("button", { name: "开始接入" }).click();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("可用", { exact: true })).toBeVisible();
  await page.getByRole("switch", { name: "启用 Claude-Sonnet-5" }).click();
  await expect(page.getByRole("switch", { name: "停用 Claude-Sonnet-5" })).toBeVisible();

  const loggedOut = page.waitForRequest((request) => {
    if (request.method() !== "POST") return false;
    return new URL(request.url()).pathname.endsWith("/settings/provider/agents/codebuddy-sdk/logout");
  });
  await page.getByRole("button", { name: "登出" }).click();
  await loggedOut;
  await expect(page.getByRole("status")).toHaveText("已登出");
  await expect(page.getByText("未登录", { exact: true })).toBeVisible();
  await expect(page.getByText("账号 mock-sdk-user")).toHaveCount(0);
  await expect(page.getByRole("switch", { name: /Claude-Sonnet-5/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "登出" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "卸载" })).toBeVisible();

  const uninstalled = page.waitForRequest((request) => {
    if (request.method() !== "DELETE") return false;
    return new URL(request.url()).pathname.endsWith("/settings/provider/agents/codebuddy-sdk");
  });
  await page.getByRole("button", { name: "卸载" }).click();
  await uninstalled;
  await expect(page.getByText("未安装", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始接入" })).toBeVisible();
  await expect(page.getByRole("button", { name: "卸载" })).toHaveCount(0);
});
