/** @vitest-environment happy-dom */
import { expect, it } from "vitest";
import { ref } from "vue";

import DelegationOccupancyBanner from "../../src/pages/conversation/components/chat-main/single/DelegationOccupancyBanner.vue";
import type { IncomingDelegation } from "../../src/pages/conversation/model/sidebar/delegation-presence.js";
import { threadAgentIdKey } from "../../src/pages/conversation/model/thread/thread-agent-id.js";
import {
  threadDelegationKey,
  type ThreadDelegationApi,
} from "../../src/pages/conversation/model/thread/thread-delegation.js";
import { threadExtrasKey, type ThreadExtras } from "../../src/pages/conversation/model/thread/thread-extras.js";
import { threadRosterKey, type ThreadRoster } from "../../src/pages/conversation/model/thread/thread-roster.js";
import { mountView } from "./mount-view.js";

function extras(name: string): ThreadExtras {
  return {
    personal: false,
    kind: "recruited",
    name,
    role: "前端",
    remark: "",
    background: "",
    recruited: true,
    syncedVersion: "1",
    busy: true,
    modelConfigured: true,
    modelLoaded: true,
  };
}

function mountBanner(
  tasks: IncomingDelegation[],
  roster: ThreadRoster,
  openProcess: ThreadDelegationApi["openProcess"] = () => undefined,
): HTMLElement {
  return mountView(DelegationOccupancyBanner, {
    props: { tasks },
    provide: [
      [threadAgentIdKey, "fe"],
      [threadExtrasKey, ref(extras("前端"))],
      [threadRosterKey, ref(roster)],
      [
        threadDelegationKey,
        ref<ThreadDelegationApi>({
          registerStarted: () => undefined,
          resolveTaskId: () => undefined,
          openProcess,
        }),
      ],
    ],
  });
}

it("画出派出方名字、任务，并能回到派出方", () => {
  const opened: string[] = [];
  const host = mountBanner(
    [{ id: "t1", fromAgentId: "pm", brief: "改登录页", createdAt: Date.now() }],
    {
      agents: [{ agentId: "pm", name: "产品", role: "产品", remark: "阿产", available: true }],
      openAgent: (agentId) => {
        opened.push(agentId);
        return "opened";
      },
    },
  );

  expect(host.textContent).toContain("来自阿产");
  expect(host.textContent).toContain("改登录页");
  host.querySelector<HTMLButtonElement>('button[aria-label="回到阿产"]')?.click();
  expect(opened).toEqual(["pm"]);
});

it("花名册没有派出方、brief 为空时仍渲染，并改走通用说法", () => {
  const host = mountBanner(
    [{ id: "t2", fromAgentId: "ghost", brief: "  ", createdAt: 0 }],
    { agents: [], openAgent: () => "dismissed" },
  );

  expect(host.textContent).toContain("来自其他 Agent");
  expect(host.textContent).toContain("未说明任务");
  expect(host.textContent).toContain("回到派出方");
  expect(host.textContent).not.toContain("来自ghost");
});

it("没有进行中的委托时不渲染横幅", () => {
  const host = mountBanner([], { agents: [], openAgent: () => "dismissed" });
  expect(host.querySelector("[role='region']")).toBeNull();
});
