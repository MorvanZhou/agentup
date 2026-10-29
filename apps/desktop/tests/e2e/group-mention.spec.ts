import { expect, test } from "./page-faults";

import { signIn } from "./helpers";
import { installRuntime } from "./runtime";

test("群聊 @ 成员会插入芯片，发送正文保留 @名字", async ({ page }) => {
  await installRuntime(page, {
    groups: [
      {
        id: "g1",
        title: "项目讨论组",
        members: [{ agentId: "weather", name: "Weaty" }],
      },
    ],
  });
  await signIn(page);
  await page.getByText("项目讨论组", { exact: true }).first().click();

  // 工具栏「提及成员」打开选择器（与输入 @ 查询同一套芯片）
  await page.locator("button[aria-label='提及成员'] >> visible=true").click();
  const picker = page.getByRole("listbox", { name: "选择要提及的成员" });
  await expect(picker).toBeVisible();
  await picker.getByRole("option", { name: /Weaty/ }).click();

  // 输入框里是原子芯片，不是一段可拆开的纯文本
  const chip = page.locator("[data-mention='Weaty']");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText("@Weaty");
  await expect(chip).toHaveAttribute("contenteditable", "false");

  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes("/runtime/groups/g1/messages"),
  );
  await page.keyboard.type("帮我看天气");
  await page.getByRole("button", { name: "发送" }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    user_id: "patient-a",
    text: "@Weaty 帮我看天气",
  });
});
