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

/** 级联左列：选接入方式（API Key / 本地 Agent App）。 */
async function selectAccessGroup(
  page: Parameters<typeof signIn>[0],
  group: "API Key 接入" | "本地 Agent App 接入",
): Promise<void> {
  await page.getByRole("button", { name: "接入方式" }).click();
  await page.getByRole("option", { name: group, exact: true }).click();
}

/** 级联右列：选接入商（当前接入方式下的厂商）。 */
async function selectAccessVendor(
  page: Parameters<typeof signIn>[0],
  vendor: RegExp,
): Promise<void> {
  await page.getByRole("button", { name: "接入商" }).click();
  await page.getByRole("option", { name: vendor }).click();
}

/** 级联：选本地 Agent App → Workbuddy / CodeBuddy。 */
async function selectLocalAgentApp(page: Parameters<typeof signIn>[0]): Promise<void> {
  await expandProviderConnect(page);
  await selectAccessGroup(page, "本地 Agent App 接入");
  await selectAccessVendor(page, /Workbuddy \/ CodeBuddy/);
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

  // 左列是接入方式（组名作 option，不再是单列 presentation 标题）
  await page.getByRole("button", { name: "接入方式" }).click();
  await expect(page.getByRole("option", { name: "API Key 接入", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "本地 Agent App 接入", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "本地 Agent App 接入", exact: true }).click();

  // 右列才是接入商；Codex 与 CodeBuddy 同组
  await page.getByRole("button", { name: "接入商" }).click();
  await expect(page.getByRole("option", { name: /^Codex/ })).toBeVisible();
  await page.getByRole("option", { name: /Workbuddy \/ CodeBuddy/ }).click();

  await expect(page.getByRole("note")).toContainText("信任模式");
  await expect(page.getByRole("button", { name: "开始接入" })).toBeVisible();
  await expect(page.getByText("待接入", { exact: true })).toBeVisible();
  // 待接入只留一句排雷，不重复品牌名
  await expect(page.getByText(/不需要先装桌面版/)).toBeVisible();

  // 旧路径：切到 API Key 组再选 Ollama，表单仍是地址 + 保存（不要被 SDK 卡片顶掉）
  await selectAccessGroup(page, "API Key 接入");
  await selectAccessVendor(page, /^Ollama/);
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
  await selectAccessGroup(page, "本地 Agent App 接入");
  await selectAccessVendor(page, /^Codex/);
  await expect(page.getByRole("note")).toContainText("信任模式");
  await expect(page.getByRole("button", { name: "开始接入" })).toBeVisible();
  await expect(page.getByText("待接入", { exact: true })).toBeVisible();
  await expect(page.getByText(/不需要先装桌面版/)).toBeVisible();
});

test("接入中可取消：点取消接入后回到待接入，可再开始", async ({ page }) => {
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
  // 本机轮询未 reload 前 pill 可能仍是「待接入」；以进度区「取消接入」为准
  await expect(page.getByRole("button", { name: "取消接入" })).toBeVisible();
  await expect(page.getByText(/正在下载接入组件/)).toBeVisible();
  // 安装中不应误提示「已打开浏览器」
  await expect(page.getByText("已打开浏览器，完成后回到这里")).toHaveCount(0);

  const cancelled = page.waitForRequest((request) => {
    if (request.method() !== "POST") return false;
    return /\/settings\/provider\/agents\/codebuddy-sdk\/install\/[^/]+\/cancel$/.test(
      new URL(request.url()).pathname,
    );
  });
  await page.getByRole("button", { name: "取消接入" }).click();
  await cancelled;
  await expect(page.getByRole("status").filter({ hasText: "已取消接入" })).toBeVisible();
  await expect(page.getByText("待接入", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始接入" })).toBeVisible();
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
  await expect(page.getByRole("status").filter({ hasText: "接入完成" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("未登录", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
  // 登录前选站点：中文界面默认中国站；点国际站再登录，请求要带 environment
  await expect(page.getByRole("radiogroup", { name: "登录方式" })).toBeVisible();
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

  // ready 后主钮为「刷新模型列表」（与顶栏「刷新全部模型」区分）
  const refreshed = page.waitForRequest((request) => {
    if (request.method() !== "POST") return false;
    return new URL(request.url()).pathname.endsWith("/settings/provider/agents/codebuddy-sdk/models");
  });
  await page.getByRole("button", { name: "刷新模型列表" }).click();
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

test("登出清登录态与模型，移除接入回到待接入", async ({ page }) => {
  await installRuntime(page);
  await signIn(page);
  await openProviderSettings(page);
  await selectLocalAgentApp(page);

  // 先走到 ready（与上条同一 mock 状态机；安装要多轮 polling，勿用默认 5s）
  await page.getByRole("button", { name: "开始接入" }).click();
  await expect(page.getByRole("status").filter({ hasText: "接入完成" })).toBeVisible({
    timeout: 20_000,
  });
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
  await expect(page.getByRole("button", { name: "移除接入" })).toBeVisible();

  const uninstalled = page.waitForRequest((request) => {
    if (request.method() !== "DELETE") return false;
    return new URL(request.url()).pathname.endsWith("/settings/provider/agents/codebuddy-sdk");
  });
  await page.getByRole("button", { name: "移除接入" }).click();
  await uninstalled;
  await expect(page.getByText("待接入", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始接入" })).toBeVisible();
  await expect(page.getByRole("button", { name: "移除接入" })).toHaveCount(0);
});
