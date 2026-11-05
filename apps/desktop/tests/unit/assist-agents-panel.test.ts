/** @vitest-environment happy-dom */
import { expect, it } from "vitest";
import { ref } from "vue";

import AssistAgentsPanel from "../../src/pages/conversation/components/chat-main/shared/thread/assistant-ui/byproducts/AssistAgentsPanel.vue";
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

function mountPanel(
  roster: ThreadRoster,
  openProcess: ThreadDelegationApi["openProcess"] = () => undefined,
  assists: AssistAgentRef[] = [assist],
  openProfile?: (input: { agent: { agentId: string } }) => void,
): HTMLElement {
  const provide: Array<[symbol | string, unknown]> = [
    [threadRosterKey, ref(roster)],
    [
      threadDelegationKey,
      ref<ThreadDelegationApi>({
        registerStarted: () => undefined,
        resolveTaskId: () => undefined,
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
