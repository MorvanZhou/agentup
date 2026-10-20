import { expect, type Page } from "@playwright/test";

/** 用浏览器登录闭环（Electron 桥接桩）进入会话页。 */
export async function signIn(page: Page): Promise<void> {
  await mockAgentUp(page);
  await page.goto("/login");
  await page.getByRole("button", { name: "前往 agentup.me" }).click();
  await expect(page).toHaveURL(/\/$/);
}

export async function openUserMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^账号：/ }).click();
}

/** 从市场招募并回到消息页；市场招募会顺带同步运行包。 */
export async function startAgent(page: Page, agentName: string): Promise<void> {
  await page.getByRole("link", { name: "Agent 市场" }).click();
  const card = page.getByRole("article").filter({ hasText: agentName });
  await card.getByRole("button", { name: "招募" }).click();
  await expect(card.getByText("已招募")).toBeVisible();
  await page.getByRole("link", { name: "消息" }).click();
  await conversationItem(page, agentName).click();
  await expect(page.getByRole("heading", { name: agentName, exact: true })).toBeVisible();
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
    selectAgentDirectory?: string | null;
    selectSkillPackage?: string | null;
    recordOpenedVisit?: boolean;
  } = {},
): Promise<void> {
  const selectAgentDirectory = options.selectAgentDirectory ?? null;
  const selectSkillPackage = options.selectSkillPackage ?? null;
  const recordOpenedVisit = options.recordOpenedVisit ?? false;
  await page.addInitScript(
    ({
      selectAgentDirectory: directory,
      selectSkillPackage: skillPackage,
      recordOpenedVisit: record,
    }) => {
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
        selectAgentDirectory: async () => directory,
        selectSkillPackage: async () => skillPackage,
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
    { selectAgentDirectory, selectSkillPackage, recordOpenedVisit },
  );
}

/** 发布流程：选目录固定返回演示路径。 */
export async function mockDirectoryPicker(page: Page): Promise<void> {
  await mockAgentUp(page, { selectAgentDirectory: "/demo/writer/agent" });
}

export async function openOwnedAgents(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Agent 市场" }).click();
  await page.getByRole("button", { name: "我发布的" }).click();
}

export async function openPublishNew(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Agent 市场" }).click();
  await page.getByRole("link", { name: "发布 Agent" }).click();
}
