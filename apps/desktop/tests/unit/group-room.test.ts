/**
 * @vitest-environment happy-dom
 */
import type { UIMessage } from "ai";
import { nextTick, ref } from "vue";
import { describe, expect, it } from "vitest";

import { desktopKey } from "../../src/app/desktop";
import GroupThread from "../../src/pages/conversation/components/chat-main/group/GroupThread.vue";
import type { ThreadRoster } from "../../src/pages/conversation/model/thread/thread-roster";
import { mountView } from "./mount-view";

function mountRoom(props: Record<string, unknown>) {
  return mountView(GroupThread, {
    props,
    provide: [[
      desktopKey,
      {
        session: ref(null),
        skipEditResendConfirm: ref(false),
        setSkipEditResendConfirm: () => undefined,
      },
    ]],
  });
}

const full = {
  id: "g1",
  title: "产品群",
  members: [
    { agentId: "pm", name: "产品经理" },
    { agentId: "design", name: "设计师" },
  ],
  lines: [
    { id: "l1", role: "system" as const, authorId: "", text: "本轮 · 产品经理", at: 1 },
    { id: "l2", role: "user" as const, authorId: "user", text: "@产品经理 做登录", at: 2 },
    { id: "l3", role: "handback" as const, authorId: "pm", text: "登录页好了", at: 3 },
    { id: "l4", role: "tool" as const, authorId: "dev", text: "tool:read", at: 4 },
  ],
  phase: "holding" as const,
  holderId: "pm",
  holderSpeaking: false,
  taskIds: ["task-1"],
  queue: [{ id: "q1", agentId: "design", text: "下一轮", messageId: "q1" }],
  updatedAt: 5,
};

const codyRoster: ThreadRoster = {
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
};

describe("group room", () => {
  it("renders the holder, the wave, and the queue, and hides tool lines", () => {
    const host = mountRoom({ room: full, token: "t", userId: "u" });
    expect(host.textContent).toContain("产品经理");
    expect(host.textContent).toContain("本轮 · 产品经理");
    expect(host.textContent).toContain("交回给 产品经理");
    expect(host.textContent).toContain("本轮结束后交给 设计师");
    expect(host.textContent).not.toContain("tool:read");
    expect(host.querySelector("[aria-label='提及成员']")).not.toBeNull();
    expect(host.querySelector("[aria-label='群菜单']")).not.toBeNull();
    expect(host.querySelector("[aria-label='插入 Skill']")).toBeNull();
    expect(host.querySelector("[aria-label='添加附件']")).not.toBeNull();
    expect(host.querySelector("[data-testid='wake-live-message']")).toBeNull();
  });

  it("puts wave stop on the composer while a subtask is still running", () => {
    const host = mountRoom({ room: full, token: "t", userId: "u" });
    // 子任务忙、输入为空：停止/发送互斥，只留停止（与 composerRunActions 一致）。
    expect(host.querySelector('button[aria-label="停止当前编排回合"]')).toBeNull();
    expect(host.querySelector('button[aria-label="停止回复"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="发送"]')).toBeNull();
  });

  it("shows the holder's in-progress turn before any settled reply", () => {
    const live: UIMessage = {
      id: "live-1",
      role: "assistant",
      parts: [{ type: "text", text: "正在画迷宫", state: "streaming" }],
    };
    const host = mountRoom({
      room: {
        ...full,
        lines: [full.lines[1]],
        holderSpeaking: true,
        taskIds: [],
        queue: [],
      },
      token: "t",
      userId: "u",
      liveMessage: live,
    });
    const bubble = host.querySelector("[data-testid='wake-live-message']");
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent).toContain("正在画迷宫");
    expect(host.textContent).not.toContain("tool:read");
  });

  it("clears artifacts unless the confirm checkbox also includes the work directory", async () => {
    const cleared: boolean[] = [];
    const host = mountRoom({
      room: full,
      token: "t",
      userId: "u",
      clearWorkspace: async (includeWork: boolean) => {
        cleared.push(includeWork);
      },
    });
    host.querySelector<HTMLButtonElement>("[aria-label='群菜单']")?.click();
    await nextTick();
    const item = [...document.querySelectorAll("[role='menuitem']")].find((entry) =>
      entry.textContent?.includes("清空工作区"),
    );
    expect(item).toBeTruthy();
    item?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTick();
    const dialog = () =>
      [...document.querySelectorAll("[role='dialog']")].find((entry) =>
        entry.textContent?.includes("将清空这个群的输出产物"),
      );
    expect(dialog()?.textContent).toContain("将清空这个群的输出产物");
    const box = dialog()?.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(box?.checked).toBe(false);
    [...(dialog()?.querySelectorAll("button") ?? [])]
      .find((entry) => entry.textContent?.trim() === "清空")
      ?.click();
    await nextTick();
    expect(cleared).toEqual([false]);

    host.querySelector<HTMLButtonElement>("[aria-label='群菜单']")?.click();
    await nextTick();
    [...document.querySelectorAll("[role='menuitem']")]
      .find((entry) => entry.textContent?.includes("清空工作区"))
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTick();
    const again = dialog()?.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(again?.checked).toBe(false);
    if (again) again.checked = true;
    again?.dispatchEvent(new Event("change", { bubbles: true }));
    [...(dialog()?.querySelectorAll("button") ?? [])]
      .find((entry) => entry.textContent?.trim() === "清空")
      ?.click();
    await nextTick();
    expect(cleared).toEqual([false, true]);
  });

  it("confirms before deleting the group", async () => {
    let deleted = false;
    const host = mountRoom({
      room: full,
      token: "t",
      userId: "u",
      deleteGroup: async () => {
        deleted = true;
      },
    });
    host.querySelector<HTMLButtonElement>("[aria-label='群菜单']")?.click();
    await nextTick();
    const item = [...document.querySelectorAll("[role='menuitem']")].find((entry) =>
      entry.textContent?.includes("删除群"),
    );
    expect(item).toBeTruthy();
    item?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTick();
    expect(document.body.textContent).toContain("确认删除这个群？");
    expect(deleted).toBe(false);
    const confirm = [...document.querySelectorAll("button")].find(
      (entry) => entry.textContent?.trim() === "删除群",
    );
    confirm?.click();
    await nextTick();
    expect(deleted).toBe(true);
  });

  it("renders when the room is missing lists", () => {
    const host = mountRoom({ room: { id: "g2" }, token: "", userId: "" });
    expect(host.textContent).toContain("空闲");
    expect(host.textContent).toContain("发送");
    expect(host.querySelector("[role=textbox]")?.getAttribute("aria-label")).toContain("成员");
    expect(host.querySelector("[aria-label='提及成员']")).toBeNull();
    expect(host.querySelector("[aria-label='插入 Skill']")).toBeNull();
    expect(host.querySelector("[aria-label='添加附件']")).toBeNull();
    expect(host.querySelector("[aria-label='群菜单']")).not.toBeNull();
  });

  it("wires AskUser / Approval / ShellHang docks from HITL props", () => {
    const host = mountRoom({
      room: { ...full, taskIds: [], queue: [] },
      token: "t",
      userId: "u",
      askUser: {
        id: "ask-1",
        toolCallId: "tc-ask",
        questions: [
          {
            question: "交付形态选哪个？",
            options: [{ title: "网页" }, { title: "终端" }],
            allowMultiple: false,
          },
        ],
      },
      approval: {
        id: "ap-1",
        toolCallId: "tc-ap",
        toolName: "bash",
        args: { command: "npm test" },
      },
      shellHang: {
        id: "hang-1",
        toolCallId: "tc-hang",
        toolName: "bash",
        command: "npm test",
        elapsedMs: 5000,
      },
    });
    expect(host.querySelector('[aria-label="需要你的回答"]')).not.toBeNull();
    expect(host.textContent).toContain("交付形态选哪个？");
    expect(host.querySelector("#approval-title-ap-1")).not.toBeNull();
    expect(host.querySelector("#shell-hang-title-hang-1")).not.toBeNull();
  });

  it("shows the sub-agent as a message when a delegation line is in the room", async () => {
    // 详情/去对话按钮契约见 group-process-bar + assist-agents-panel；这里钉群注入后的头像。
    // 有 runtime 票时默认过程 tab，简述在自己的 tab 后；切过去再钉 brief。
    const host = mountRoom({
      room: {
        ...full,
        queue: [],
        taskIds: ["task-cody"],
        lines: [
          {
            id: "l-user",
            role: "user" as const,
            authorId: "user",
            text: "做迷宫",
            at: 1,
          },
          {
            id: "l-agent",
            role: "agent" as const,
            authorId: "pm",
            text: "已派给 Cody",
            at: 2,
          },
          {
            id: "l-cody",
            role: "delegation" as const,
            authorId: "cody",
            authorName: "Cody",
            text: "",
            at: 3,
            taskId: "task-cody",
            brief: "画迷宫",
            activity: "running" as const,
            handoff: "pending" as const,
          },
        ],
      },
      roster: codyRoster,
      memberRoles: [{ agentId: "cody", role: "工程师", avatarUrl: "https://cdn.example/cody.webp" }],
      token: "t",
      userId: "u",
    });

    expect(
      host.querySelector('img[alt="Cody"][src="https://cdn.example/cody.webp"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain("已派给 Cody");
    expect(host.textContent).toContain("进行中");
    expect(host.textContent).not.toContain("画迷宫");
    const briefTab = host.querySelector<HTMLElement>('[data-testid="delegation-tab-brief"]');
    expect(briefTab).not.toBeNull();
    // reka 的 tab 在 mousedown 时切换，click 不会改选中。
    briefTab?.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true }),
    );
    await nextTick();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(host.textContent).toContain("画迷宫");
    expect(host.textContent).not.toContain("进行中的异步任务");
  });
});
