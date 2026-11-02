import { expect, test } from "./page-faults";

import { conversationItem, signIn } from "./helpers";
import { installRuntime } from "./runtime";

/**
 * 本地 Agent App（SDK）接入：回合进行中的新消息不再 409，而是进 followUp 队列，
 * 本轮结束后合并成一条再开一轮（docs/agent_cli §12.8 / §12.8.1）。
 */
test("回合中发的新消息进队列，可置顶 / 编辑 / 删除 / 清空", async ({ page }) => {
  await installRuntime(page, {
    prompt: "follow-up",
    recruited: ["weather"],
    localVersions: { weather: 1 },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();

  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("先查全国");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("先查全国")).toBeVisible();

  // 回合还在跑：再发两条应进队列（runtime 返回 202），不是 409 也不是立刻开新轮。
  // 一条一条来：等第一条真的入队再发第二条，避免入队后清空输入框把第二条吃掉。
  const firstQueued = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/runtime/follow-ups" &&
      (request.postData() ?? "").includes("只要北京"),
  );
  await composer.fill("只要北京");
  await page.getByRole("button", { name: "发送" }).click();
  await firstQueued;
  // 等客户端 enqueueing 收尾 + 条子落地，再发下一条（否则连按会被串行锁静默丢掉）
  await expect(page.getByRole("status", { name: /已排队/ })).toContainText("已排队 1 条");
  // 用回车发送：真人主路径，也避开「发送成功后按钮立刻消失」的自动化竞态
  const queued = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/runtime/follow-ups" &&
      (request.postData() ?? "").includes("再看看上海"),
  );
  await composer.fill("再看看上海");
  await composer.press("Enter");
  await queued;

  const queue = page.getByRole("status", { name: /已排队/ });
  await expect(queue).toBeVisible();
  await expect(queue).toContainText("已排队 2 条");
  await expect(queue.locator("li")).toHaveCount(2);
  await expect(queue.locator("li").first()).toContainText("只要北京");

  // 置顶：第二条挪到最前
  await queue
    .locator("li")
    .filter({ hasText: "再看看上海" })
    .getByRole("button", { name: "提到最前" })
    .click();
  await expect(queue.locator("li").first()).toContainText("再看看上海");

  // 编辑：内联输入 + 回车保存
  await queue
    .locator("li")
    .filter({ hasText: "只要北京" })
    .getByRole("button", { name: "编辑这条" })
    .click();
  await queue.getByRole("textbox").fill("改成广州");
  await queue.getByRole("textbox").press("Enter");
  await expect(queue.locator("li").filter({ hasText: "改成广州" })).toBeVisible();
  await expect(queue.locator("li").filter({ hasText: "只要北京" })).toHaveCount(0);

  // 删除一条
  await queue
    .locator("li")
    .filter({ hasText: "改成广州" })
    .getByRole("button", { name: "删除这条" })
    .click();
  await expect(queue).toContainText("已排队 1 条");
  await expect(queue.locator("li")).toHaveCount(1);

  // 全部清空：队列空了就不占位置
  await queue.getByRole("button", { name: "全部清空" }).click();
  await expect(queue).toHaveCount(0);
});

test("停止后弹「还有 N 条，要继续吗」，清空后队列不再占位", async ({ page }) => {
  await installRuntime(page, {
    prompt: "follow-up",
    recruited: ["weather"],
    localVersions: { weather: 1 },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();

  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("先查全国");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("先查全国")).toBeVisible();

  // 回合中排两条：一条一条来，等第一条真的入队再发第二条
  const firstQueued = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/runtime/follow-ups" &&
      (request.postData() ?? "").includes("只要北京"),
  );
  await composer.fill("只要北京");
  await page.getByRole("button", { name: "发送" }).click();
  await firstQueued;
  await expect(page.getByRole("status", { name: /已排队/ })).toContainText("已排队 1 条");

  const queued = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/runtime/follow-ups" &&
      (request.postData() ?? "").includes("再看看上海"),
  );
  await composer.fill("再看看上海");
  await composer.press("Enter");
  await queued;
  await expect(page.getByRole("status", { name: /已排队/ })).toContainText("已排队 2 条");

  // 停止不清队列（§12.8.1）：弹一次确认
  await page.getByRole("button", { name: "停止回复" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("还有 2 条没发出去");
  await dialog.getByRole("button", { name: "清空队列" }).click();
  await expect(page.getByRole("status", { name: /已排队/ })).toHaveCount(0);
});

test("队列被消费时：先出 user message，assistant 才在它下面流式输出", async ({ page }) => {
  await installRuntime(page, {
    prompt: "follow-up-drain",
    recruited: ["weather"],
    localVersions: { weather: 1 },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();

  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("先查全国");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("先查全国")).toBeVisible();

  // 回合还在跑：排两条，runtime 会把整串拼成一条发出去
  const firstQueued = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/runtime/follow-ups" &&
      (request.postData() ?? "").includes("只要北京"),
  );
  await composer.fill("只要北京");
  await page.getByRole("button", { name: "发送" }).click();
  await firstQueued;
  await expect(page.getByRole("status", { name: /已排队/ })).toContainText("已排队 1 条");

  const queued = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/runtime/follow-ups" &&
      (request.postData() ?? "").includes("再看看上海"),
  );
  await composer.fill("再看看上海");
  await composer.press("Enter");
  await queued;
  await expect(page.getByRole("status", { name: /已排队/ })).toContainText("已排队 2 条");

  // 直播窗口很短（流结束后历史会重挂线程）：用 MutationObserver 记下「谁先出现」
  await page.evaluate(() => {
    const holder = window as unknown as { __followUpOrder?: string[] };
    holder.__followUpOrder = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          const text = node.textContent ?? "";
          // 拼好的整串只会出现在用户气泡里（队列条是分开的两条）
          const user = text.indexOf("只要北京\n再看看上海");
          const assistant = text.indexOf("已收到，正在查");
          if (user >= 0 && assistant >= 0) {
            holder.__followUpOrder?.push(user <= assistant ? "user-first" : "assistant-first");
          } else if (user >= 0) {
            holder.__followUpOrder?.push("user");
          } else if (assistant >= 0) {
            holder.__followUpOrder?.push("assistant");
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

  // 第一轮结束后 runtime 消费队列：先出用户那条（整串），助手正文在它之后
  await page.waitForFunction(
    () => ((window as unknown as { __followUpOrder?: string[] }).__followUpOrder?.length ?? 0) > 0,
    undefined,
    { timeout: 20_000 },
  );
  const order = await page.evaluate(
    () => (window as unknown as { __followUpOrder?: string[] }).__followUpOrder ?? [],
  );
  const verdict =
    order.find((entry) => entry === "user-first" || entry === "assistant-first") ??
    (order.indexOf("user") >= 0 && order.indexOf("user") < order.indexOf("assistant")
      ? "user-first"
      : "assistant-first");
  expect(order).toContain("assistant");
  expect(verdict).toBe("user-first");
});

test("消费轮进行中还能继续排队：发送按钮可见，消息进队列", async ({ page }) => {
  await installRuntime(page, {
    prompt: "follow-up-drain",
    recruited: ["weather"],
    localVersions: { weather: 1 },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();

  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("先查全国");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("先查全国")).toBeVisible();

  // 第一轮还在跑：排一条，等第一轮收完由 runtime 消费
  const firstQueued = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/runtime/follow-ups" &&
      (request.postData() ?? "").includes("只要北京"),
  );
  await composer.fill("只要北京");
  await page.getByRole("button", { name: "发送" }).click();
  await firstQueued;

  // 直播窗口很短（流结束历史重挂线程）：在第一轮收尾前就装好 MutationObserver，
  // 记下「消费轮确实跑过」（用户那条 + 助手正文）
  await page.evaluate(() => {
    const holder = window as unknown as { __drainSeen?: string[] };
    holder.__drainSeen = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          const text = node.textContent ?? "";
          if (text.includes("只要北京")) holder.__drainSeen?.push("user");
          if (text.includes("已收到，正在查")) holder.__drainSeen?.push("assistant");
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

  // 等第一轮收完：历史里出现「旧回复」，队列随后被 runtime 消费（条子撤掉）
  await expect(page.getByText("旧回复").last()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("status", { name: /已排队/ })).toHaveCount(0, { timeout: 20_000 });
  await page.waitForFunction(
    () =>
      ((window as unknown as { __drainSeen?: string[] }).__drainSeen ?? []).includes("assistant"),
    undefined,
    { timeout: 20_000 },
  );

  // 消费轮跑过之后 wake busy 仍持续（desktop-pulse 保持 busy_turns）：composer 处于第二轮状态。
  // 此时 composer 只亮「停止」是 bug——SDK 接入下发送仍是入队语义，应能继续排队。
  const secondQueued = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/runtime/follow-ups" &&
      (request.postData() ?? "").includes("再看看上海"),
  );
  await composer.fill("再看看上海");
  await page.getByRole("button", { name: "发送" }).click();
  await secondQueued;
  await expect(page.getByRole("status", { name: /已排队/ })).toContainText("已排队 1 条");
});

test("队列为空时不占位，回合仍在跑", async ({ page }) => {
  await installRuntime(page, {
    prompt: "follow-up",
    recruited: ["weather"],
    localVersions: { weather: 1 },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();

  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("先查全国");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("先查全国")).toBeVisible();
  await expect(page.getByRole("status", { name: /已排队/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "停止回复" })).toBeVisible();
});
