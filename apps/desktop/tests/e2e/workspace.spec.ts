import { expect, test } from "./page-faults";

import { mockAgentUp, signIn } from "./helpers";
import { installRuntime } from "./runtime";

test("会话右侧可以浏览并编辑工作空间", async ({ page }) => {
  await mockAgentUp(page);
  await installRuntime(page);
  await signIn(page);

  await page.getByRole("button", { name: "工作空间", exact: true }).click();
  await expect(page.getByRole("button", { name: "工作空间", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("navigation", { name: "工作空间分区" })).toBeVisible();
  await expect(page.getByRole("button", { name: "输出产物", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("checkbox", { name: "全选" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "note.txt", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "reports", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: ".pi", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "WORK", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "note.txt", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "文件内容" });
  await expect(editor).toHaveValue("门诊记录");
  await editor.fill("更新后的记录");
  const saved = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && request.url().includes("/runtime/personal-assistant/workspace/file"),
  );
  await page.getByRole("button", { name: "保存" }).click();
  expect((await saved).postDataJSON()).toMatchObject({
    path: "ARTIFACT/note.txt",
    text: "更新后的记录",
  });
  await page.getByRole("button", { name: "返回" }).click();

  await page.getByRole("button", { name: "更多操作：note.txt" }).click();
  const revealed = page.waitForFunction(() =>
    window.openedVisit?.endsWith("/ARTIFACT/note.txt"),
  );
  await page.getByRole("menuitem", { name: "在 Finder 中显示" }).click();
  await revealed;
  await page.getByRole("button", { name: "更多操作：note.txt" }).click();
  await page.getByRole("menuitem", { name: "重命名" }).click();
  await page.getByRole("dialog").getByLabel("名称").fill("记录.txt");
  await page.getByRole("dialog").getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("button", { name: "记录.txt", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "新建文件", exact: true }).click();
  await page.getByRole("dialog").getByLabel("名称").fill("todo.txt");
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("textbox", { name: "文件内容" })).toHaveValue("");
  await page.getByRole("button", { name: "返回" }).click();
  await expect(page.getByRole("button", { name: "todo.txt", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "更多操作：记录.txt" }).click();
  await page.getByRole("menuitem", { name: "删除" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除" }).click();
  await expect(page.getByRole("button", { name: "记录.txt", exact: true })).toHaveCount(0);

  await page.getByRole("checkbox", { name: "选择 todo.txt" }).check();
  await page.getByRole("checkbox", { name: "选择 reports" }).check();
  await expect(page.getByText("已选 2 项")).toBeVisible();
  await page.getByRole("button", { name: "删除所选" }).click();
  await expect(page.getByRole("dialog")).toContainText("已选的 2 项");
  await page.getByRole("dialog").getByRole("button", { name: "删除" }).click();
  await expect(page.getByRole("button", { name: "todo.txt", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "reports", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "我上传的", exact: true }).click();
  await expect(page.getByRole("button", { name: "我上传的", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "新建文件", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "我上传的", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "工作空间", exact: true }).click();
  await expect(page.getByRole("button", { name: "工作空间", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
