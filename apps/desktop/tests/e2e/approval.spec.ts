import { expect, test } from "./page-faults";

import { conversationItem, signIn, startAgent } from "./helpers";
import { installRuntime } from "./runtime";

test("停止回复后审批浮层收起", async ({ page }) => {
  await installRuntime(page, { prompt: "approval" });
  await signIn(page);
  await startAgent(page, "呼吸科医生");
  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("运行天气脚本");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toBeVisible();
  await expect(page.getByRole("button", { name: "停止回复" })).toBeVisible();
  await page.getByRole("button", { name: "停止回复" }).click();
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
});

test("新对话后审批浮层收起", async ({ page }) => {
  await installRuntime(page, { prompt: "approval" });
  await signIn(page);
  await startAgent(page, "呼吸科医生");
  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("运行天气脚本");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toBeVisible();
  await page.getByRole("button", { name: "新对话" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "新对话" })).toBeVisible();
  const cleared = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes("/runtime/agents/respiratory-doctor/context"),
  );
  await dialog.getByRole("button", { name: "新对话" }).click();
  await cleared;
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toHaveCount(0);
});

test("危险工具调用需要用户按次允许", async ({ page }) => {
  await installRuntime(page, { prompt: "approval" });
  await signIn(page);
  await startAgent(page, "呼吸科医生");
  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("运行天气脚本");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: "node weather.mjs" })).toBeVisible();
  // 主按钮默认仅这一次；更长范围在下拉里。
  const decision = page.waitForRequest((request) =>
    request.url().includes("/runtime/approvals/approval-respiratory-doctor"),
  );
  await page.getByRole("button", { name: "允许", exact: true }).click();
  expect((await decision).postDataJSON()).toEqual({ allow: true });
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toHaveCount(0);
});

test("命令审批可对本会话持续允许", async ({ page }) => {
  await installRuntime(page, { prompt: "approval" });
  await signIn(page);
  await startAgent(page, "呼吸科医生");
  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("运行天气脚本");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toBeVisible();
  await page.getByRole("button", { name: "选择更长的允许范围" }).click();
  const decision = page.waitForRequest((request) =>
    request.url().includes("/runtime/approvals/approval-respiratory-doctor"),
  );
  await page.getByRole("menuitem", { name: "本次对话" }).click();
  expect((await decision).postDataJSON()).toEqual({ allow: true, scope: "session" });
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toHaveCount(0);
});

test("命令审批可对本 Agent 持续允许", async ({ page }) => {
  await installRuntime(page, { prompt: "approval" });
  await signIn(page);
  await startAgent(page, "呼吸科医生");
  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("运行天气脚本");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toBeVisible();
  await page.getByRole("button", { name: "选择更长的允许范围" }).click();
  const decision = page.waitForRequest((request) =>
    request.url().includes("/runtime/approvals/approval-respiratory-doctor"),
  );
  await page.getByRole("menuitem", { name: "这个助手" }).click();
  expect((await decision).postDataJSON()).toEqual({ allow: true, scope: "agent" });
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toHaveCount(0);
});

test("多个会话同时待审批时，确认面板只属于当前 thread", async ({ page }) => {
  await installRuntime(page, {
    prompt: "approval",
    recruited: ["respiratory-doctor", "weather"],
    localVersions: { "respiratory-doctor": 1, weather: 1 },
  });
  await signIn(page);

  await conversationItem(page, "呼吸科医生").click();
  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("运行脚本 A");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toHaveCount(1);

  await conversationItem(page, "Weaty").click();
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toHaveCount(0);
  await composer.fill("运行脚本 B");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toHaveCount(1);

  await conversationItem(page, "呼吸科医生").click();
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toHaveCount(1);
  const doctorDecision = page.waitForRequest((request) =>
    request.url().includes("/runtime/approvals/approval-respiratory-doctor"),
  );
  await page.getByRole("button", { name: "允许", exact: true }).click();
  await doctorDecision;
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toHaveCount(0);

  await conversationItem(page, "Weaty").click();
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toHaveCount(1);
  const weatherDecision = page.waitForRequest((request) =>
    request.url().includes("/runtime/approvals/approval-weather"),
  );
  await page.getByRole("button", { name: "允许", exact: true }).click();
  await weatherDecision;
  await expect(page.getByRole("heading", { name: "要在电脑上运行操作" })).toHaveCount(0);
});
