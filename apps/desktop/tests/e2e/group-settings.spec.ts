import { expect, test } from "./page-faults";

import { signIn } from "./helpers";
import { installRuntime } from "./runtime";

async function openGroupSettings(page: import("@playwright/test").Page, title: string): Promise<void> {
  await page.getByText(title, { exact: true }).first().click();
  await page.getByRole("button", { name: "群设置" }).click();
  await expect(page.getByRole("list", { name: "成员" })).toBeVisible();
}

test("有群时冷启动默认打开侧栏首位群，无需再点侧栏", async ({ page }) => {
  await installRuntime(page, {
    recruited: ["weather", "respiratory-doctor"],
    localVersions: { weather: 1, "respiratory-doctor": 1 },
    groups: [
      {
        id: "g-boot",
        title: "启动小队",
        updatedAt: 100,
        members: [
          { agentId: "weather", name: "Weaty" },
          { agentId: "respiratory-doctor", name: "呼吸科医生" },
        ],
      },
    ],
  });
  await signIn(page);
  // 主区已是群表面（标题 + 群设置），不是默认一对一私人助理
  await expect(page.getByRole("heading", { name: "启动小队", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "群设置" })).toBeVisible();
});

test("群设置可改名、加人，并展示姓名与岗位", async ({ page }) => {
  await installRuntime(page, {
    recruited: ["weather", "respiratory-doctor", "coder"],
    localVersions: { weather: 1, "respiratory-doctor": 1, coder: 1 },
    extraAgents: [{ agent_id: "coder", name: "Cody", role: "工程师" }],
    groups: [
      {
        id: "g-settings",
        title: "开发小队",
        members: [
          { agentId: "weather", name: "Weaty" },
          { agentId: "respiratory-doctor", name: "呼吸科医生" },
        ],
      },
    ],
  });
  await signIn(page);
  await openGroupSettings(page, "开发小队");

  // 姓名下挂岗位（来自本机名片，不靠群记录）
  const weaty = page.getByRole("list", { name: "成员" }).getByRole("listitem").filter({ hasText: "Weaty" });
  await expect(weaty).toContainText("气象员");

  const renamed = page.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      request.url().includes("/runtime/groups/g-settings") &&
      !request.url().includes("/members"),
  );
  const titleInput = page.locator("#group-settings-title");
  await titleInput.fill("新小队");
  await titleInput.blur();
  expect((await renamed).postDataJSON()).toMatchObject({
    user_id: "patient-a",
    title: "新小队",
  });

  const members = page.getByRole("list", { name: "成员" });
  const added = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && request.url().includes("/runtime/groups/g-settings/members"),
  );
  await members.getByRole("button", { name: "添加", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "添加成员" });
  await expect(addDialog).toBeVisible();
  await addDialog.getByRole("button", { name: /Cody/ }).click();
  await addDialog.getByRole("button", { name: "完成" }).click();
  expect((await added).postDataJSON()).toMatchObject({
    user_id: "patient-a",
    members: [
      { agentId: "weather", name: "Weaty" },
      { agentId: "respiratory-doctor", name: "呼吸科医生" },
      { agentId: "coder", name: "Cody" },
    ],
  });
  await expect(members).toContainText("Cody");
  await expect(members).toContainText("工程师");

  // 减员：加减换成确认/取消；勾选后确认才提交
  await members.getByRole("button", { name: "移除" }).click();
  await expect(members.getByRole("button", { name: "添加", exact: true })).toHaveCount(0);
  await expect(members.getByRole("button", { name: "移除", exact: true })).toBeVisible();
  await expect(members.getByRole("button", { name: "取消" })).toBeVisible();
  await members.getByRole("listitem").filter({ hasText: "Cody" }).click();
  const removed = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && request.url().includes("/runtime/groups/g-settings/members"),
  );
  await members.getByRole("button", { name: "移除", exact: true }).click();
  expect((await removed).postDataJSON()).toMatchObject({
    user_id: "patient-a",
    members: [
      { agentId: "weather", name: "Weaty" },
      { agentId: "respiratory-doctor", name: "呼吸科医生" },
    ],
  });
  await expect(members).not.toContainText("Cody");
});

test("群满员时点添加会提示上限", async ({ page }) => {
  await installRuntime(page, {
    recruited: ["weather"],
    localVersions: { weather: 1 },
    groups: [
      {
        id: "g-full",
        title: "满员小队",
        members: [
          { agentId: "m1", name: "一" },
          { agentId: "m2", name: "二" },
          { agentId: "m3", name: "三" },
          { agentId: "m4", name: "四" },
          { agentId: "m5", name: "五" },
          { agentId: "m6", name: "六" },
        ],
      },
    ],
  });
  await signIn(page);
  await openGroupSettings(page, "满员小队");

  const add = page.getByRole("list", { name: "成员" }).getByRole("button", { name: "添加", exact: true });
  await expect(add).toBeVisible();
  await expect(add).toHaveAttribute("title", /最多 6 人/);
  await add.click();
  await expect(page.getByRole("alert")).toContainText(/最多 6 人/);
});
