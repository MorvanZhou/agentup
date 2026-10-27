import { expect, test } from "./page-faults";

import {
  conversationItem,
  expectComposerText,
  messagesNav,
  openMarket,
  signIn,
  startAgent,
  syncAgent,
} from "./helpers";
import { installRuntime } from "./runtime";

test("私人助理无需招募即可独立对话", async ({ page }) => {
  await installRuntime(page);
  await signIn(page);
  await expect(conversationItem(page, "小A")).toBeVisible();

  const prompt = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/runtime/personal-assistant/prompt"),
  );
  await page.getByRole("textbox", { name: /^发送消息/ }).fill("整理今天的计划");
  await page.getByRole("button", { name: "发送" }).click();
  expect((await prompt).postDataJSON()).toMatchObject({ user_id: "patient-a" });
  await expect(page.getByRole("list").getByText("你好", { exact: true })).toBeVisible();
});

test("招募并同步后，发送消息会呈现文本、推理和工具调用", async ({ page }) => {
  await installRuntime(page);
  await signIn(page);
  await expect(conversationItem(page, "小A")).toBeVisible();

  const recruited = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/respiratory-doctor/recruit"),
  );
  const synced = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/respiratory-doctor/sync"),
  );
  await startAgent(page, "呼吸科医生");
  await recruited;
  expect((await synced).postDataJSON()).toMatchObject({ user_id: "patient-a" });

  await expect(page.getByRole("button", { name: "Weaty", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "今天想让它做什么？" })).toBeVisible();
  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await expect(composer).toBeEnabled();

  await composer.fill("咳嗽三天");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("咳嗽三天")).toBeVisible();
  await expect(page.getByRole("list").getByText("你好", { exact: true })).toBeVisible();
  // turn 结束后：总结为默认 tab；过程里 reasoning / trailing tool 各成折叠段
  await page.getByRole("tab", { name: "过程" }).click();
  const processTriggers = page.getByRole("button", { name: /\d+ 个步骤/ });
  await expect(processTriggers).toHaveCount(2);
  await processTriggers.nth(0).click();
  await page.getByRole("button", { name: "Thinking" }).click();
  await expect(page.getByText("先看")).toBeVisible();
  await processTriggers.nth(1).click();
  await expect(page.getByRole("button", { name: /Read/ })).toBeVisible();
  await page.getByRole("button", { name: /Read/ }).click();
  await expect(page.getByText("病历")).toBeVisible();
});

test("已招募的会话会读回本机聊天记录，续聊不会并入上一轮回复", async ({ page }) => {
  await installRuntime(page, {
    recruited: ["weather"],
    history: {
      weather: [
        { id: "user-0", role: "user", parts: [{ type: "text", text: "上海天气怎么样？" }] },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolCallId: "call-1",
              toolName: "bash",
              state: "output-available",
              input: { command: "node check-weather.mjs 上海" },
              output: '{"city":"上海"}',
            },
            { type: "text", text: "上海今天晴，24°C。", state: "done" },
          ],
        },
      ],
    },
  });
  const loaded = page.waitForRequest(
    (request) =>
      request.method() === "GET" &&
      request.url().includes("/runtime/agents/weather/history?user_id=patient-a"),
  );
  await signIn(page);
  await conversationItem(page, "Weaty").click();
  await loaded;
  await expect(page.getByText("上海天气怎么样？")).toBeVisible();
  await expect(page.getByText("上海今天晴，24°C。")).toBeVisible();
  await page.getByRole("tab", { name: "过程" }).click();
  await expect(page.getByRole("button", { name: /\d+ 个步骤/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^bash\b/i })).toHaveCount(0);
  await page.getByRole("button", { name: /\d+ 个步骤/ }).click();
  const bashCard = page.getByRole("button", { name: /^bash\b/i });
  await expect(bashCard).toBeVisible();
  await bashCard.click();
  await expect(page.getByText('{"city":"上海"}')).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^发送消息/ })).toBeDisabled();

  await syncAgent(page, "Weaty");
  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await expect(composer).toBeEnabled();
  await composer.fill("北京呢？");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("list").getByText("你好", { exact: true })).toHaveCount(1);
  await expect(page.getByText("上海今天晴，24°C。")).toBeVisible();
  await composer.fill("广州呢？");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("list").getByText("你好", { exact: true })).toHaveCount(2);

  await openMarket(page);
  await messagesNav(page).click();
  await expect(page.getByText("上海今天晴，24°C。")).toBeVisible();
});

test("mermaid 图渲染为图片后可预览并缩放", async ({ page }) => {
  const mermaidText = [
    "流程如下：",
    "",
    "```mermaid",
    "flowchart LR",
    "  A[开始] --> B[结束]",
    "```",
  ].join("\n");
  await installRuntime(page, {
    recruited: ["weather"],
    localVersions: { weather: 1 },
    history: {
      weather: [
        { id: "user-0", role: "user", parts: [{ type: "text", text: "画个图" }] },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: mermaidText, state: "done" }],
        },
      ],
    },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();
  await expect(page.getByText("流程如下：")).toBeVisible();

  const diagram = page.locator(".aui-mermaid[data-rendered='true']");
  await expect(diagram).toBeVisible({ timeout: 15_000 });
  await expect(diagram.locator("img.aui-mermaid-img")).toBeVisible();

  await diagram.click();
  const preview = page.getByTestId("image-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("img", { name: "Mermaid 图" })).toBeVisible();
  await expect(preview.getByText("100%")).toBeVisible();

  await preview.getByRole("button", { name: "放大" }).click();
  await expect(preview.getByText("125%")).toBeVisible();
  await preview.getByRole("button", { name: "缩小" }).click();
  await expect(preview.getByText("100%")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
});

test("菜单清空聊天后界面与侧栏预览一并消失", async ({ page }) => {
  await installRuntime(page, {
    recruited: ["weather"],
    localVersions: { weather: 1 },
    previews: { weather: "上海今天晴，24°C。" },
    history: {
      weather: [
        { id: "user-0", role: "user", parts: [{ type: "text", text: "上海天气怎么样？" }] },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "上海今天晴，24°C。", state: "done" }],
        },
      ],
    },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();
  await expect(page.getByText("上海天气怎么样？")).toBeVisible();
  await expect(page.getByText("上海今天晴，24°C。").first()).toBeVisible();

  await page.getByRole("button", { name: "会话菜单" }).click();
  await page.getByRole("menuitem", { name: "清空聊天" }).click();
  const cleared = page.waitForRequest(
    (request) =>
      request.method() === "DELETE" &&
      request.url().includes("/runtime/agents/weather/history?user_id=patient-a"),
  );
  await page.getByRole("dialog", { name: "清空聊天？" }).getByRole("button", { name: "清空" }).click();
  await cleared;

  await expect(page.getByText("上海天气怎么样？")).toHaveCount(0);
  await expect(page.getByText("上海今天晴，24°C。")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "今天想让它做什么？" })).toBeVisible();
});

test("新对话后仍显示历史，并出现分隔标记", async ({ page }) => {
  await installRuntime(page, {
    recruited: ["weather"],
    localVersions: { weather: 1 },
    history: {
      weather: [
        { id: "user-0", role: "user", parts: [{ type: "text", text: "上海天气怎么样？" }] },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "上海今天晴，24°C。", state: "done" }],
        },
      ],
    },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();
  await expect(page.getByRole("heading", { name: "Weaty" })).toBeVisible();
  await expect(page.getByText("上海天气怎么样？")).toBeVisible();

  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("还想问下明天呢");

  await page.getByRole("button", { name: "新对话" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: "不再提醒" })).toBeVisible();
  await dialog.getByRole("checkbox", { name: "不再提醒" }).check();
  const cleared = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/runtime/agents/weather/context"),
  );
  await dialog.getByRole("button", { name: "新对话" }).click();
  expect((await cleared).postDataJSON()).toMatchObject({ user_id: "patient-a" });

  await expect(page.getByText("上海天气怎么样？")).toBeVisible();
  await expect(page.getByText("上海今天晴，24°C。")).toBeVisible();
  await expect(page.getByRole("separator", { name: "新对话" })).toBeVisible();
  await expectComposerText(page, "还想问下明天呢");

  // 勾选「不再提醒」后再次点「新对话」应直接请求，不再弹窗。
  const clearedAgain = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/runtime/agents/weather/context"),
  );
  await page.getByRole("button", { name: "新对话" }).click();
  await clearedAgain;
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("修改备注名后顶栏与侧栏显示备注名，原名仍可见", async ({ page }) => {
  await installRuntime(page, {
    recruited: ["weather"],
    localVersions: { weather: 1 },
    history: {
      weather: [
        { id: "user-0", role: "user", parts: [{ type: "text", text: "你好" }] },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "你好，我是Weaty。", state: "done" }],
        },
      ],
    },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();
  await expect(page.getByRole("heading", { name: "Weaty" })).toBeVisible();

  await page.getByRole("button", { name: "会话菜单" }).click();
  await page.getByRole("menuitem", { name: "对话配置" }).click();
  await expect(page.getByRole("heading", { name: "对话配置" })).toBeVisible();
  const saved = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && request.url().includes("/runtime/agents/weather/remark"),
  );
  const remark = page.getByPlaceholder("输入备注名");
  await remark.fill("小天气");
  await remark.blur();
  expect((await saved).postDataJSON()).toMatchObject({ remark: "小天气" });

  await expect(page.getByRole("heading", { name: "小天气" })).toBeVisible();
  // 顶栏副文案仍带原名；侧栏主标题为备注名。
  await expect(page.getByText(/气象员 · Weaty/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^小天气/ })).toBeVisible();
});

test("会话顶栏解雇后侧栏移除该对话", async ({ page }) => {
  await installRuntime(page, {
    recruited: ["weather", "respiratory-doctor"],
    localVersions: { weather: 1, "respiratory-doctor": 1 },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();
  await expect(page.getByRole("heading", { name: "Weaty" })).toBeVisible();

  await page.getByRole("button", { name: "会话菜单" }).click();
  await page.getByRole("menuitem", { name: "解雇" }).click();
  const dismissed = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes("/runtime/agents/weather/dismiss"),
  );
  await page.getByRole("dialog", { name: "确认解雇这个 Agent？" }).getByRole("button", { name: "解雇" }).click();
  expect((await dismissed).postDataJSON()).toMatchObject({ user_id: "patient-a" });

  await expect(page.getByRole("button", { name: "Weaty", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "小A" })).toBeVisible();
});

test("解雇后再招募不会残留旧对话记录", async ({ page }) => {
  await installRuntime(page, {
    recruited: ["weather"],
    localVersions: { weather: 1 },
    history: {
      weather: [
        { id: "user-0", role: "user", parts: [{ type: "text", text: "上海天气怎么样？" }] },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "上海今天晴，24°C。", state: "done" }],
        },
      ],
    },
  });
  await signIn(page);
  await conversationItem(page, "Weaty").click();
  await expect(page.getByText("上海天气怎么样？")).toBeVisible();

  await page.getByRole("button", { name: "会话菜单" }).click();
  await page.getByRole("menuitem", { name: "解雇" }).click();
  await page.getByRole("dialog", { name: "确认解雇这个 Agent？" }).getByRole("button", { name: "解雇" }).click();
  await expect(page.getByRole("button", { name: "Weaty", exact: true })).toHaveCount(0);

  await startAgent(page, "Weaty");
  await expect(page.getByText("上海天气怎么样？")).toHaveCount(0);
  await expect(page.getByText("上海今天晴，24°C。")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "今天想让它做什么？" })).toBeVisible();
});

test("没有配置模型时，会话在发送前提示前往设置", async ({ page }) => {
  await installRuntime(page, { prompt: "missing-model", modelConfigured: false });
  await signIn(page);
  await startAgent(page, "呼吸科医生");
  await expect(page.getByRole("textbox", { name: /^发送消息/ })).toBeDisabled();
  await expect(page.locator("p:visible").filter({ hasText: "先连接 AI 模型" })).toBeVisible();
  await page.locator("a:visible").filter({ hasText: "前往设置" }).click();
  await expect(page).toHaveURL(/\/settings\?section=provider$/);
});

test("未同步 Agent 的菜单显示更新红点，同步后清除", async ({ page }) => {
  await installRuntime(page, { recruited: ["respiratory-doctor"] });
  await signIn(page);
  await expect(page.getByRole("button", { name: "更多操作：呼吸科医生（有可用更新）" })).toBeVisible();
  await syncAgent(page, "呼吸科医生");
  await expect(page.getByRole("heading", { name: "今天想让它做什么？" })).toBeVisible();
  await expect(page.getByRole("button", { name: "更多操作：呼吸科医生", exact: true })).toBeVisible();
});

test("消息列表显示未读角标，选中后清除", async ({ page }) => {
  await installRuntime(page, {
    recruited: ["respiratory-doctor", "weather"],
    localVersions: { "respiratory-doctor": 1, weather: 1 },
    unread: { weather: 2 },
  });
  await signIn(page);
  await expect(page.getByRole("button", { name: "Weaty，2 条未读" })).toBeVisible();
  // 主导航角标与侧栏会话行汇总数一致（此处仅未读 2）。
  await expect(messagesNav(page)).toHaveAttribute("aria-label", /2 条未读/);
  await expect(messagesNav(page).locator("span").filter({ hasText: "2" })).toBeVisible();
  await page.getByRole("button", { name: "Weaty，2 条未读" }).click();
  await expect(page.getByRole("button", { name: "Weaty", exact: true })).toBeVisible();
});

test("输出中发送新要求会停下当前回复，并以新的用户消息另起一条", async ({ page }) => {
  await installRuntime(page, {
    prompt: "interruptible",
    recruited: ["respiratory-doctor"],
    localVersions: { "respiratory-doctor": 1 },
  });
  await signIn(page);
  await conversationItem(page, "呼吸科医生").click();
  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("先查全国");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByText("先查全国")).toBeVisible();
  await expect(page.getByRole("button", { name: "停止回复" })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送" })).toHaveCount(0);

  await composer.fill("只要北京");
  const send = page.getByRole("button", { name: "发送" });
  await expect(send).toBeVisible();
  await expect(page.getByRole("button", { name: "停止回复" })).toHaveCount(0);

  await composer.fill("");
  await expect(page.getByRole("button", { name: "停止回复" })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送" })).toHaveCount(0);

  await composer.fill("只要北京");
  await expect(send).toBeVisible();
  await expect(page.getByRole("button", { name: "停止回复" })).toHaveCount(0);

  const followUp = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes("/agents/respiratory-doctor/prompt") &&
      (request.postData() ?? "").includes("只要北京"),
  );
  await send.click();
  expect((await followUp).postDataJSON()).toMatchObject({ text: "只要北京" });

  const thread = page.getByRole("list");
  await expect(thread.getByText("只要北京")).toBeVisible();
  await expect(thread.getByText("新回复", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "停止回复" })).toHaveCount(0);
});

test("stream 中切换会话或页面再回来，仍接回同一轮回复", async ({ page }) => {
  await installRuntime(page, {
    prompt: "slow-stream",
    recruited: ["respiratory-doctor", "weather"],
    localVersions: { "respiratory-doctor": 1, weather: 1 },
  });
  let prompts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/agents\/[^/]+\/prompt$/.test(new URL(request.url()).pathname)) {
      prompts += 1;
    }
  });
  await signIn(page);
  await conversationItem(page, "呼吸科医生").click();
  const composer = page.getByRole("textbox", { name: /^发送消息/ });
  await composer.fill("咳嗽三天");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("咳嗽三天")).toBeVisible();

  await conversationItem(page, "Weaty").click();
  await expect(page.getByRole("button", { name: "呼吸科医生，正在回复" })).toBeVisible();
  await openMarket(page);
  await messagesNav(page).click();
  await conversationItem(page, "呼吸科医生").click();

  await expect(page.getByRole("list").getByText("你好", { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(prompts).toBe(1);
});
