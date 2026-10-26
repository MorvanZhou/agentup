import { expect, test } from "./page-faults";

import { conversationItem, signIn } from "./helpers";
import { installRuntime } from "./runtime";

const DELEGATION_TASK_ID = "task-e2e-weather-1";

test("委托过程弹窗复用主 Agent 的工具卡 UI", async ({ page }) => {
  await installRuntime(page, {
    recruited: ["weather"],
    history: {
      "personal-assistant": [
        {
          id: "user-deleg",
          role: "user",
          parts: [{ type: "text", text: "帮我查一下天气" }],
        },
        {
          id: "assistant-deleg",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolCallId: "call-deleg-1",
              toolName: "delegate_to_agent",
              state: "output-available",
              input: { agent_id: "weather", brief: "查询当前天气情况" },
              output:
                `Delegation completed.\n` +
                `task_id: ${DELEGATION_TASK_ID}\n` +
                `agent: 天气 (weather)\n` +
                `result:\n晴，25°C`,
            },
            { type: "text", text: "今天晴，25°C。", state: "done" },
          ],
        },
      ],
    },
    delegationHistories: {
      [DELEGATION_TASK_ID]: [
        {
          id: "deleg-user",
          role: "user",
          parts: [{ type: "text", text: "查询当前天气情况" }],
        },
        {
          id: "deleg-assistant",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolCallId: "call-bash-1",
              toolName: "bash",
              state: "output-available",
              input: { command: "node check-weather.mjs" },
              output: '{"city":"上海","temp":25}',
            },
            { type: "text", text: "上海晴，25°C。", state: "done" },
          ],
        },
      ],
    },
  });

  await signIn(page);
  await expect(conversationItem(page, "小A")).toBeVisible();
  await conversationItem(page, "小A").click();

  await expect(page.getByText("今天晴，25°C。")).toBeVisible();

  // 协助 Agent tab → 顶栏「过程」直接打开（无需先展开详情）
  await page.getByRole("tab", { name: "协助 Agent" }).click();
  await expect(page.getByText("协助 Agent", { exact: true }).first()).toBeVisible();

  const historyReq = page.waitForRequest(
    (request) =>
      request.method() === "GET" &&
      request.url().includes(`/runtime/personal-assistant/delegations/${DELEGATION_TASK_ID}/history`),
  );
  await page.getByRole("button", { name: /查看 Weaty 的执行过程/ }).click();
  await historyReq;

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /执行过程/ })).toBeVisible();
  await expect(dialog.locator("[data-testid=delegation-process-body]")).toBeVisible();

  // 与主会话相同：工具折叠段 + bash 工具卡（不是空「工具」占位）
  const processTrigger = dialog.getByRole("button", { name: /\d+ 个步骤/ });
  await expect(processTrigger).toBeVisible();
  await processTrigger.click();
  const bashCard = dialog.getByRole("button", { name: /^bash\b/i });
  await expect(bashCard).toBeVisible();
  await bashCard.click();
  await expect(dialog.getByText('{"city":"上海","temp":25}')).toBeVisible();
  await expect(dialog.getByText("上海晴，25°C")).toBeVisible();
});
