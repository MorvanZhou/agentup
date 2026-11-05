/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";

import GroupSettingsPanel from "../../src/pages/conversation/components/chat-main/group/GroupSettingsPanel.vue";
import type { AgentCard } from "../../src/shared/model/runtime/runtime.js";
import { mountView } from "./mount-view";

function card(partial: Partial<AgentCard> & Pick<AgentCard, "agentId" | "name">): AgentCard {
  return {
    background: "",
    latestVersion: 1,
    latestDigest: "d",
    localVersion: 1,
    recruited: true,
    hasAvatar: false,
    role: "",
    remark: "",
    recruitCount: 0,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("GroupSettingsPanel", () => {
  it("renders members, add/remove controls, and group name with full data", () => {
    const host = mountView(GroupSettingsPanel, {
      props: {
        title: "经验交流",
        members: [
          { agentId: "a1", name: "莫烦" },
          { agentId: "a2", name: "开发" },
          { agentId: "a3", name: "设计" },
        ],
        defaultHolderId: "a1",
        agents: [
          card({ agentId: "a1", name: "莫烦", role: "博主" }),
          card({ agentId: "a2", name: "开发", role: "工程师" }),
          card({ agentId: "a3", name: "设计", role: "设计师" }),
          card({ agentId: "a4", name: "测试" }),
        ],
        avatars: { a1: "https://example.com/a.png" },
        busy: false,
        renameTitle: vi.fn(async () => undefined),
        setMembers: vi.fn(async () => undefined),
      },
    });
    expect(host.textContent).toContain("莫烦");
    expect(host.textContent).toContain("博主");
    expect(host.textContent).toContain("工程师");
    expect(host.querySelector('[aria-label="添加"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="移除"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="默认应答者"]')).toBeTruthy();
    expect(host.textContent).toContain("清空工作区");
    expect(host.textContent).toContain("删除群");
    expect((host.querySelector("#group-settings-title") as HTMLInputElement | null)?.value).toBe(
      "经验交流",
    );
  });

  it("still mounts when members and agents are empty", () => {
    const host = mountView(GroupSettingsPanel, {
      props: {
        title: "",
        members: [
          { agentId: "a1", name: "甲" },
          { agentId: "a2", name: "乙" },
        ],
        defaultHolderId: "a1",
        agents: [],
        busy: true,
        renameTitle: vi.fn(async () => undefined),
        setMembers: vi.fn(async () => undefined),
      },
    });
    // 忙时加人仍可见但禁用；仅两人时仍有移除入口但禁用
    expect(host.querySelector('[aria-label="添加"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="关闭群设置"]')).toBeTruthy();
  });

  it("keeps the add control visible when the group is full", () => {
    const host = mountView(GroupSettingsPanel, {
      props: {
        title: "满员群",
        members: [
          { agentId: "a1", name: "一" },
          { agentId: "a2", name: "二" },
          { agentId: "a3", name: "三" },
          { agentId: "a4", name: "四" },
          { agentId: "a5", name: "五" },
          { agentId: "a6", name: "六" },
        ],
        defaultHolderId: "a1",
        agents: [card({ agentId: "a7", name: "七" })],
        busy: false,
        renameTitle: vi.fn(async () => undefined),
        setMembers: vi.fn(async () => undefined),
      },
    });
    const add = host.querySelector('[aria-label="添加"]') as HTMLButtonElement | null;
    expect(add).toBeTruthy();
    expect(add?.disabled).toBe(false);
    expect(add?.getAttribute("title") ?? "").toMatch(/最多 6 人/);
  });
});
