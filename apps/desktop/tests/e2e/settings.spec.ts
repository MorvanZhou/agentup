import { expect, test } from "@playwright/test";

import { mockAgentUp, openUserMenu, signIn } from "./helpers";
import { installRuntime } from "./runtime";

test("编辑私人助理资料并明确资源作用域", async ({ page }) => {
  await installRuntime(page);
  await signIn(page);
  await page.getByRole("link", { name: "Agents" }).click();

  await expect(page.getByRole("heading", { name: "我的助理", exact: true })).toBeVisible();
  await expect(page.getByText("不会带给从市场招募的 Agent")).toBeVisible();
  const saved = page.waitForRequest((request) => {
    if (
      request.method() !== "PUT" ||
      !request.url().endsWith("/runtime/personal-assistant/profile")
    ) {
      return false;
    }
    const body = request.postDataJSON() as { name?: string; role?: string; background?: string };
    return body.name === "小舟" && body.background === "擅长研究整理与资料分析。";
  });
  await page.getByLabel("名称").fill("小舟");
  await page.getByLabel("人物背景").fill("擅长研究整理与资料分析。");
  await page.getByRole("button", { name: "保存" }).click();
  expect((await saved).postDataJSON()).toEqual({
    user_id: "patient-a",
    name: "小舟",
    role: "我的助理",
    background: "擅长研究整理与资料分析。",
  });
  await expect(page.getByRole("status")).toHaveText("私人助理资料已保存");

  await page.getByRole("link", { name: "消息" }).click();
  await expect(page.getByText("小舟", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "会话菜单" }).click();
  await page.getByRole("menuitem", { name: "助理设置" }).click();
  await expect(page).toHaveURL(/\/agents\/assistant/);
  await expect(page.getByRole("heading", { name: "我的助理", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "消息" }).click();
  await page.getByRole("button", { name: /^更多操作：小舟/ }).click();
  await page.getByRole("menuitem", { name: "助理设置" }).click();
  await expect(page).toHaveURL(/\/agents\/assistant/);
  await expect(page.getByRole("heading", { name: "我的助理", exact: true })).toBeVisible();
});

test("更新账号昵称并刷新本机会话", async ({ page }) => {
  await installRuntime(page);
  await signIn(page);
  await page.getByRole("link", { name: "设置" }).click();
  await page.getByRole("button", { name: "账号", exact: true }).click();

  await expect(page.getByRole("heading", { name: "账号设置" })).toBeVisible();
  await expect(page.getByLabel("邮箱")).toHaveValue("patient-a@example.com");
  const nickname = page.getByLabel("昵称");
  await expect(nickname).toHaveValue("patient-a");

  const saved = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/runtime/me"),
  );
  await nickname.fill("小舟");
  await nickname.blur();
  expect((await saved).postDataJSON()).toEqual({ nickname: "小舟" });
  await expect(page.getByRole("status")).toHaveText("昵称已更新");
  await expect(page.getByRole("button", { name: /^账号：小舟/ })).toBeVisible();
});

test("切换账号外观偏好并应用到 document", async ({ page }) => {
  await installRuntime(page);
  await signIn(page);
  const loaded = page.waitForResponse(
    (response) => response.request().method() === "GET" && response.url().endsWith("/runtime/preferences"),
  );
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "设置" }).click();
  await page.getByRole("button", { name: "外观" }).click();
  await loaded;

  await expect(page.getByRole("heading", { name: "外观" })).toBeVisible();
  const saved = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/runtime/preferences"),
  );
  await page.getByRole("button", { name: /^深色/ }).click();
  expect((await saved).postDataJSON()).toEqual({ theme_mode: "dark" });
  await expect(page.getByRole("status")).toHaveText("外观偏好已保存到账号");
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.getByRole("button", { name: /^浅色/ }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("配置本地 Ollama，并展示平台 AI 占位", async ({ page }) => {
  await installRuntime(page, { modelConfigured: false });
  await signIn(page);
  const loaded = page.waitForResponse(
    (response) => response.request().method() === "GET" && response.url().endsWith("/runtime/settings/provider"),
  );
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "设置" }).click();
  await page.getByRole("button", { name: "AI 服务" }).click();
  await loaded;

  await expect(page.getByRole("heading", { name: "可用模型" })).toBeVisible();
  await expect(page.getByText("AgentUp 平台 AI")).toBeVisible();
  await expect(page.getByText("后续开放")).toBeVisible();

  await expect(page.getByLabel("服务地址")).toHaveValue("http://localhost:11434/v1");
  await page.getByLabel("服务地址").fill("http://127.0.0.1:11434/v1/");
  const saved = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/runtime/settings/provider/connections"),
  );
  const refreshed = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes("/runtime/settings/provider/connections/") &&
      request.url().endsWith("/refresh-models"),
  );
  await page.getByRole("button", { name: "保存连接" }).click();
  expect((await saved).postDataJSON()).toMatchObject({
    template_id: "ollama",
    base_url: "http://127.0.0.1:11434/v1/",
  });
  expect((await saved).postDataJSON()).not.toHaveProperty("custom_model_id");
  await refreshed;
  await expect(page.getByRole("status")).toHaveText("服务商已保存");
  await expect(page.getByRole("switch", { name: "停用 qwen3:4b" })).toBeVisible();

  await page.getByRole("link", { name: "消息" }).click();
  await expect(page).toHaveURL(/\/$/);
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "设置" }).click();
  await page.getByRole("button", { name: "AI 服务" }).click();
  await expect(page.getByRole("switch", { name: "停用 qwen3:4b" })).toBeVisible();
});

test("配置私人助理 Skills、工作规则与外部工具", async ({ page }) => {
  await mockAgentUp(page, { selectSkillPackage: "/demo/skills/note-taker" });
  await installRuntime(page);
  await signIn(page);
  await page.getByRole("link", { name: "Agents" }).click();
  await page.getByRole("button", { name: "高级设置（可选）" }).click();

  const installed = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/runtime/settings/skills/install"),
  );
  await page.getByRole("button", { name: "添加 Skill" }).click();
  await page.getByRole("menuitem", { name: "选择文件夹" }).click();
  expect((await installed).postDataJSON()).toEqual({
    user_id: "patient-a",
    path: "/demo/skills/note-taker",
  });
  await expect(page.getByRole("status")).toHaveText("已安装技能");
  await expect(page.getByText("note-taker", { exact: true })).toBeVisible();
  const agentsContent = `# 私人助理规则

回答简洁。
`;
  const agentsSaved = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/runtime/settings/agents-md"),
  );
  await page.getByLabel("工作规则").fill(agentsContent);
  const mcpSaved = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/runtime/settings/mcp"),
  );
  await page.getByLabel("MCP").fill(`{
  "notes": {
    "url": "http://127.0.0.1:9001/mcp"
  }
}`);
  await page.getByRole("button", { name: "保存" }).click();
  expect((await agentsSaved).postDataJSON()).toEqual({
    user_id: "patient-a",
    content: agentsContent,
  });
  expect((await mcpSaved).postDataJSON()).toEqual({
    user_id: "patient-a",
    mcp_servers: { notes: { url: "http://127.0.0.1:9001/mcp" } },
  });
  await expect(page.getByRole("status")).toHaveText("私人助理资料已保存");
});
