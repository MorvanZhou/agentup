import { expect, type Page } from "@playwright/test";

/** 用浏览器登录闭环（Electron 桥接桩）进入会话页。 */
export async function signIn(
  page: Page,
  bridge: Parameters<typeof mockAgentUp>[1] = {},
): Promise<void> {
  await mockAgentUp(page, bridge);
  await page.goto("/login");
  await page.getByRole("button", { name: "前往 agentup.me" }).click();
  await expect(page).toHaveURL(/\/$/);
}

export async function openUserMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^账号：/ }).click();
}

/** 轨栏「消息」入口；未读时 aria-label 会带「n 条未读」后缀。 */
export function messagesNav(page: Page) {
  return page.getByRole("link", { name: /^消息/ });
}

/** 账号菜单 → 设置 → 账号页登出（菜单内不再放登出项）。 */
export async function signOut(page: Page): Promise<void> {
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "账号设置" })).toBeVisible();
  await page.getByRole("button", { name: "登出" }).click();
}

/**
 * 打开市场页（路由 `/market`）。
 * 必须走轨栏 RouterLink：`page.goto` 会整页刷新，冲掉 KeepAlive 会话与进行中的 stream。
 */
export async function openMarket(page: Page): Promise<void> {
  const link = page.getByRole("link", { name: "市场", exact: true });
  await expect(link).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await link.click();
    try {
      await expect(page).toHaveURL(/\/market/, { timeout: 2_000 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  await expect(page.getByRole("heading", { name: "Agent 市场" })).toBeVisible();
}

/** 从市场招募并回到消息页；市场招募会顺带同步运行包。 */
export async function startAgent(page: Page, agentName: string): Promise<void> {
  await openMarket(page);
  const card = page.getByRole("article").filter({ hasText: agentName });
  await card.getByRole("button", { name: "招募" }).click();
  await expect(card.getByLabel("已招")).toBeVisible();
  await messagesNav(page).click();
  await conversationItem(page, agentName).click();
  await expect(page.getByRole("heading", { name: agentName, exact: true })).toBeVisible();
}

/** contenteditable 作曲器：Playwright toHaveValue 不适用。 */
export async function expectComposerText(page: Page, text: string): Promise<void> {
  await expect(page.getByRole("textbox", { name: /^发送消息/ })).toHaveText(text);
}

export async function syncAgent(page: Page, agentName: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`更多操作：${agentName}`) }).click();
  await page.getByRole("menuitem", { name: "更新" }).click();
}

/** 侧栏会话项：名称后可能带「未读 / 正在回复 / 等待批准」后缀。 */
export function conversationItem(page: Page, agentName: string) {
  return page.getByRole("button", { name: new RegExp(`^${escapeRegExp(agentName)}`) });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
}

/** 注入 Electron 桥接桩。须在页面导航前调用。 */
export async function mockAgentUp(
  page: Page,
  options: {
    selectSkillPackage?: string | null;
    recordOpenedVisit?: boolean;
  } = {},
): Promise<void> {
  const selectSkillPackage = options.selectSkillPackage ?? null;
  const recordOpenedVisit = options.recordOpenedVisit ?? false;
  await page.addInitScript(
    ({ selectSkillPackage: skillPackage, recordOpenedVisit: record }) => {
      const existing = window.agentUp;
      window.agentUp = {
        platform: "darwin",
        readSession: async () => {
          const raw = localStorage.getItem("agentup.session");
          return raw ? (JSON.parse(raw) as { userId: string; email: string; nickname: string; token: string }) : null;
        },
        saveSession: async (session) => {
          localStorage.setItem("agentup.session", JSON.stringify(session));
        },
        clearSession: async () => {
          localStorage.removeItem("agentup.session");
        },
        selectSkillPackage:
          skillPackage !== null
            ? async () => skillPackage
            : existing?.selectSkillPackage ?? (async () => null),
        selectDirectory: async () => null,
        openVisitDirectory: async (path) => {
          if (record) window.openedVisit = path;
        },
        revealInFolder: async (target) => {
          window.openedVisit = target;
        },
        openPath: async (target) => {
          window.openedVisit = target;
        },
        // Web 登录 / OAuth：不打开真实浏览器，loopback 直接回一次性码
        openExternal: async () => undefined,
        oauthLoopbackStart: async () => ({ loopbackUri: "http://127.0.0.1:9/callback", port: 9 }),
        oauthLoopbackWait: async () => ({ code: "mock-oauth-code" }),
        oauthLoopbackTakePending: async () => null,
        oauthLoopbackPeekPending: async () => null,
        oauthLoopbackStop: async () => undefined,
        webUrl: async () => "http://127.0.0.1:3000",
      };
    },
    { selectSkillPackage, recordOpenedVisit },
  );
}

/**
 * 打开 Agents 管理页（默认本机分区）。
 * 轨栏 RouterLink 偶发点中未跳转（与 openMarket 同类），须等 URL 再继续。
 */
export async function openAgents(page: Page): Promise<void> {
  const link = page.getByRole("link", { name: "Agents", exact: true });
  await expect(link).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await link.click();
    try {
      await expect(page).toHaveURL(/\/agents\//, { timeout: 2_000 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

export async function openOwnedAgents(page: Page): Promise<void> {
  await openAgents(page);
  await page.getByRole("link", { name: "我发布的" }).click();
  await expect(page).toHaveURL(/\/agents\/owned/);
}

export async function openPublishNew(page: Page): Promise<void> {
  await openOwnedAgents(page);
  await page.getByRole("link", { name: "发布 Agent" }).click();
  await expect(page).toHaveURL(/\/agents\/owned\/new/);
}

/** 给 Agent 编辑表单选一张最小合法 PNG 头像（可选）。 */
export async function pickAgentAvatar(page: Page): Promise<void> {
  // 1×1 PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.locator('input[type="file"][accept*="image"]').setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByRole("button", { name: "更换头像" })).toBeVisible();
}
