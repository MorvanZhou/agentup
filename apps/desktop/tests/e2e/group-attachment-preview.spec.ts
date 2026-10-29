import { expect, test } from "./page-faults";

import { signIn } from "./helpers";
import { installRuntime } from "./runtime";

test("群聊插入图片时，预览在输入框附件条而不是文件芯片里", async ({ page }) => {
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

  const attachInput = page
    .locator("button[aria-label='添加附件'] >> visible=true")
    .locator("xpath=preceding-sibling::input[@type='file']");
  await attachInput.setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake-png-bytes"),
  });

  // 和一对一相同：附件条上的缩略图，可点击放大。输入框正文里没有文件芯片。
  const preview = page.getByRole("button", { name: "预览图片" });
  await expect(preview).toBeVisible();
  await expect(preview.locator("img")).toHaveAttribute("src", /^blob:/);
  await expect(page.locator("[data-file]")).toHaveCount(0);

  await page.getByRole("button", { name: "发送" }).click();
  // 发出去的正文仍带工作区引用，气泡里才出现文件芯片。
  await expect(page.locator('[data-file="ATTACHMENTS/cover_94319ddb.png"]')).toBeVisible();
});
