import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

import { conversationItem, mockAgentUp, signIn } from "./helpers";
import { installRuntime } from "./runtime";

const outputDir = resolve(process.cwd(), "../web/public/marketing");
const taskId = "task-marketing-weather";

test.describe("marketing assets", () => {
  test.skip(!process.env.AGENTUP_CAPTURE_MARKETING, "Only runs when refreshing website screenshots.");

  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  test("capture real AgentUp market and collaboration screens", async ({ page }) => {
    await mockAgentUp(page);
    await installRuntime(page, {
      recruited: ["weather"],
      history: {
        "personal-assistant": [
          {
            id: "user-marketing",
            role: "user",
            parts: [{ type: "text", text: "帮我整理明天出差要带的东西，也看看会不会下雨。" }],
          },
          {
            id: "assistant-marketing",
            role: "assistant",
            parts: [
              {
                type: "dynamic-tool",
                toolCallId: "call-marketing-delegation",
                toolName: "delegate_to_agent",
                state: "output-available",
                input: { agent_id: "weather", brief: "查询上海明天的天气和降雨情况" },
                output:
                  `Delegation completed.\n` +
                  `task_id: ${taskId}\n` +
                  "agent: Weaty (weather)\n" +
                  "result:\n明天下午有阵雨，建议携带折叠伞。",
              },
              {
                type: "text",
                text: "Weaty 提醒明天下午有阵雨。我已经把折叠伞加入出差清单，其他材料按会议安排整理好了。",
                state: "done",
              },
            ],
          },
        ],
      },
      delegationHistories: {
        [taskId]: [
          {
            id: "delegation-marketing-user",
            role: "user",
            parts: [{ type: "text", text: "查询上海明天的天气和降雨情况" }],
          },
          {
            id: "delegation-marketing-assistant",
            role: "assistant",
            parts: [{ type: "text", text: "明天下午有阵雨，建议携带折叠伞。", state: "done" }],
          },
        ],
      },
    });

    await signIn(page);

    await page.getByRole("link", { name: "Agent 市场" }).click();
    await expect(page.getByRole("heading", { name: "Agent 市场" })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(2);
    await page.screenshot({
      path: resolve(outputDir, "agent-market.png"),
      animations: "disabled",
    });

    await page.getByRole("link", { name: "消息" }).click();
    await conversationItem(page, "小A").click();
    await expect(page.getByText("折叠伞加入出差清单")).toBeVisible();
    await page.getByRole("tab", { name: "协助 Agent" }).click();
    await expect(page.getByText("Weaty", { exact: true }).first()).toBeVisible();
    await page.screenshot({
      path: resolve(outputDir, "agent-collaboration.png"),
      animations: "disabled",
    });
  });
});
