/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from "vitest";
import { ref } from "vue";

import AssistAgentsPanel from "../../src/pages/conversation/components/chat-main/shared/thread/assistant-ui/byproducts/AssistAgentsPanel.vue";
import { resetAssistStartMsCacheForTests } from "../../src/pages/conversation/model/message/assist-elapsed.js";
import type { AssistAgentRef } from "../../src/pages/conversation/model/message/message-assistants.js";
import {
  threadDelegationKey,
  type ThreadDelegationApi,
} from "../../src/pages/conversation/model/thread/thread-delegation.js";
import {
  threadRosterKey,
  type ThreadRoster,
} from "../../src/pages/conversation/model/thread/thread-roster.js";
import { agentProfileHostKey } from "../../src/shared/components/agent/agent-profile-host.js";
import { mountView } from "./mount-view.js";

afterEach(() => {
  resetAssistStartMsCacheForTests();
  vi.useRealTimers();
});

const assist: AssistAgentRef = {
  agentId: "cody",
  nameHint: "Cody",
  brief: "画一个简单迷宫",
  reply: "",
  status: "completed",
  asyncDispatched: true,
  toolCallId: "tc-1",
  taskId: "task-cody",
};

/** 进行中且无墙钟 timing：会走本地起点兜底。 */
const runningAssist: AssistAgentRef = {
  agentId: "weaty",
  nameHint: "Weaty",
  brief: "查天气",
  reply: "",
  status: "running",
  toolCallId: "tc-weaty",
  taskId: "",
};

function mountPanel(
  roster: ThreadRoster,
  openProcess: ThreadDelegationApi["openProcess"] = () => undefined,
  assists: AssistAgentRef[] = [assist],
  openProfile?: (input: { agent: { agentId: string } }) => void,
  resolveReplyModel: ThreadDelegationApi["resolveReplyModel"] = () => undefined,
): HTMLElement {
  const provide: Array<[symbol | string, unknown]> = [
    [threadRosterKey, ref(roster)],
    [
      threadDelegationKey,
      ref<ThreadDelegationApi>({
        registerStarted: () => undefined,
        resolveTaskId: () => undefined,
        resolveReplyModel,
        openProcess,
      }),
    ],
  ];
  if (openProfile) {
    provide.push([agentProfileHostKey, { open: openProfile }]);
  }
  return mountView(AssistAgentsPanel, {
    props: { assists, variant: "panel" },
    provide,
  });
}

it("花名册有头像时用 img，详情与去对话可点", () => {
  const opened: string[] = [];
  const processes: Array<{ taskId: string; toAgentId: string; toAgentAvatarUrl?: string }> = [];
  const host = mountPanel(
    {
      agents: [
        {
          agentId: "cody",
          name: "Cody",
          role: "工程师",
          remark: "",
          avatarUrl: "https://cdn.example/cody.webp",
          available: true,
        },
      ],
      openAgent: (agentId) => {
        opened.push(agentId);
        return "opened";
      },
    },
    (target) => {
      processes.push({
        taskId: target.taskId,
        toAgentId: target.toAgentId,
        toAgentAvatarUrl: target.toAgentAvatarUrl,
      });
    },
  );

  const avatar = host.querySelector<HTMLImageElement>(
    'img[alt="Cody"][src="https://cdn.example/cody.webp"]',
  );
  expect(avatar).not.toBeNull();

  host
    .querySelector<HTMLButtonElement>('button[aria-label="查看 Cody 的执行过程"]')
    ?.click();
  expect(processes).toEqual([
    {
      taskId: "task-cody",
      toAgentId: "cody",
      toAgentAvatarUrl: "https://cdn.example/cody.webp",
    },
  ]);

  host.querySelector<HTMLButtonElement>('button[aria-label="前往 Cody 的对话"]')?.click();
  expect(opened).toEqual(["cody"]);
});

it("点协助头像开资料", () => {
  const profiles: string[] = [];
  const host = mountPanel(
    {
      agents: [
        {
          agentId: "cody",
          name: "Cody",
          role: "工程师",
          remark: "",
          avatarUrl: "https://cdn.example/cody.webp",
          available: true,
        },
      ],
      openAgent: () => "opened",
    },
    () => undefined,
    [assist],
    (input) => {
      profiles.push(input.agent.agentId);
    },
  );
  host.querySelector<HTMLButtonElement>('button[aria-label="查看 Cody"]')?.click();
  expect(profiles).toEqual(["cody"]);
});

it("花名册缺字段时仍渲染占位首字，按钮仍可触发", () => {
  const opened: string[] = [];
  const processes: string[] = [];
  const host = mountPanel(
    {
      agents: [],
      openAgent: (agentId) => {
        opened.push(agentId);
        return "opened";
      },
    },
    (target) => {
      processes.push(target.taskId);
    },
  );

  expect(host.querySelector('img[alt="Cody"]')).toBeNull();
  expect(host.textContent).toContain("C");
  host
    .querySelector<HTMLButtonElement>('button[aria-label="查看 Cody 的执行过程"]')
    ?.click();
  host.querySelector<HTMLButtonElement>('button[aria-label="前往 Cody 的对话"]')?.click();
  expect(processes).toEqual(["task-cody"]);
  expect(opened).toEqual(["cody"]);
});

it("进行中可从 started 登记展示模型标形（不必等工具结果）", () => {
  const host = mountPanel(
    { agents: [], openAgent: () => "opened" },
    () => undefined,
    [runningAssist],
    undefined,
    (key) =>
      key === "tc-weaty"
        ? {
            templateId: "openai",
            modelId: "gpt-4o",
            vendorId: "openai",
            modelLabel: "GPT-4o",
          }
        : undefined,
  );
  expect(
    host.querySelector('button[aria-label="本轮模型：GPT-4o"]'),
  ).not.toBeNull();
});

it("详情/去对话文案包在窄宽可藏的 span 里，aria 仍完整", () => {
  const host = mountPanel({ agents: [], openAgent: () => "opened" });
  const processBtn = host.querySelector<HTMLButtonElement>(
    'button[aria-label="查看 Cody 的执行过程"]',
  );
  const chatBtn = host.querySelector<HTMLButtonElement>(
    'button[aria-label="前往 Cody 的对话"]',
  );
  expect(processBtn).not.toBeNull();
  expect(chatBtn).not.toBeNull();
  const processLabel = processBtn?.querySelector("span.hidden");
  const chatLabel = chatBtn?.querySelector("span.hidden");
  expect(processLabel?.textContent).toBe("详情");
  expect(chatLabel?.textContent).toBe("去对话");
  expect(processLabel?.className).toMatch(/@\[20rem\]:inline/);
  expect(chatLabel?.className).toMatch(/@\[20rem\]:inline/);
});

it("无 startedAt 时切走再挂回面板，耗时仍从首次起点累计（不重起表）", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T03:00:00.000Z"));

  const emptyRoster: ThreadRoster = {
    agents: [],
    openAgent: () => "opened",
  };
  const first = mountPanel(emptyRoster, () => undefined, [runningAssist]);
  expect(first.textContent).toMatch(/<1s/);

  // 模拟 Tabs unmountOnHide：卸掉面板后再挂（切 tab 再回来）
  first.remove();
  vi.setSystemTime(new Date("2026-11-09T03:00:05.000Z"));
  const second = mountPanel(emptyRoster, () => undefined, [runningAssist]);
  expect(second.textContent).toMatch(/5\.0s/);
  expect(second.textContent).not.toMatch(/<1s/);
});
