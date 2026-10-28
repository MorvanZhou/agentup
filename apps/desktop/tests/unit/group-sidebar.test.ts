/**
 * @vitest-environment happy-dom
 */
import { ref } from "vue";
import { describe, expect, it } from "vitest";

import { desktopKey } from "../../src/app/desktop";
import GroupSidebarItem from "../../src/pages/conversation/components/agent-sidebar/GroupSidebarItem.vue";
import { buildConversationRows } from "../../src/pages/conversation/model/sidebar/conversation-row.js";
import {
  buildGroupSidebarRow,
  collectGroupUnreadBumps,
  groupAttentionFromSnapshot,
  groupIsWorking,
  groupSidebarPreview,
  groupSidebarPreviewLabel,
  groupUnreadKey,
  groupUnreadLabel,
  mergeSidebarSlots,
  shouldBumpGroupUnread,
  type GroupSidebarRow,
} from "../../src/pages/conversation/model/sidebar/group-sidebar.js";
import type { GroupRoom } from "../../src/shared/api/runtime/groups.js";
import type { AgentCard } from "../../src/shared/model/runtime/runtime.js";
import { mountView } from "./mount-view";

function mountGroupItem(props: { row: GroupSidebarRow; avatars?: Record<string, string> }) {
  return mountView(GroupSidebarItem, {
    props,
    provide: [[desktopKey, { session: ref(null) }]],
  });
}

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

function room(partial: Partial<GroupRoom> & Pick<GroupRoom, "id">): GroupRoom {
  return {
    title: "",
    members: [],
    lines: [],
    phase: "idle",
    holderId: null,
    holderSpeaking: false,
    taskIds: [],
    pendingDelegations: [],
    queue: [],
    updatedAt: 0,
    ...partial,
  };
}

describe("sidebar groups", () => {
  it("pins the personal assistant and mixes groups with direct chats by last message", () => {
    const rows = buildConversationRows({
      conversations: [
        card({ agentId: "pa", name: "助理", kind: "personal" }),
        card({ agentId: "dev", name: "开发" }),
      ],
      previews: {},
      lastActiveAt: { pa: 1, dev: 10 },
      selectedId: "dev",
      busyAgent: "",
      unread: {},
    });
    const slots = mergeSidebarSlots(
      rows,
      [
        room({
          id: "g1",
          title: "产品群",
          members: [
            { agentId: "pm", name: "产品" },
            { agentId: "design", name: "设计" },
          ],
          lines: [
            { id: "a", role: "user", authorId: "user", text: "做登录", at: 50 },
            { id: "b", role: "tool", authorId: "dev", text: "tool:read", at: 90 },
          ],
        }),
      ],
      "",
    );
    expect(slots.map((slot) => (slot.kind === "agent" ? slot.row.agent.agentId : slot.row.room.id))).toEqual([
      "pa",
      "g1",
      "dev",
    ]);
    expect(
      groupSidebarPreview(slots[1] && slots[1].kind === "group" ? slots[1].row.room : room({ id: "x" })),
    ).toBe("做登录");
  });

  it("marks holding/task groups as working and surfaces group HITL ahead of idle chats", () => {
    expect(groupIsWorking(room({ id: "g", phase: "holding" }))).toBe(true);
    expect(groupIsWorking(room({ id: "g", phase: "task" }))).toBe(true);
    expect(groupIsWorking(room({ id: "g", phase: "idle" }))).toBe(false);

    const attention = groupAttentionFromSnapshot({
      approvals: [{ groupId: "g-hitl" }],
      askUsers: [{ groupId: "g-ask" }],
      shellHangs: [{ groupId: "g-hang" }],
    });
    expect([...attention.awaitingApproval].sort()).toEqual(["g-hang", "g-hitl"]);
    expect([...attention.awaitingAskUser]).toEqual(["g-ask"]);

    const rows = buildConversationRows({
      conversations: [
        card({ agentId: "pa", name: "助理", kind: "personal" }),
        card({ agentId: "dev", name: "开发" }),
      ],
      previews: {},
      lastActiveAt: { pa: 1, dev: 100 },
      selectedId: "",
      busyAgent: "",
      unread: {},
    });
    const slots = mergeSidebarSlots(
      rows,
      [
        room({
          id: "g-hitl",
          title: "待批群",
          updatedAt: 1,
          lines: [{ id: "a", role: "user", authorId: "user", text: "旧预览", at: 1 }],
        }),
        room({
          id: "g-work",
          title: "忙着的群",
          phase: "holding",
          updatedAt: 50,
          lines: [{ id: "b", role: "user", authorId: "user", text: "进行中", at: 50 }],
        }),
      ],
      "",
      { attention },
    );
    // HITL 群置顶；其余仍按最近活跃（dev 比忙着的群更新）
    expect(slots.map((slot) => (slot.kind === "agent" ? slot.row.agent.agentId : slot.row.room.id))).toEqual([
      "pa",
      "g-hitl",
      "dev",
      "g-work",
    ]);
    const hitl = slots.find((slot) => slot.kind === "group" && slot.row.room.id === "g-hitl");
    const work = slots.find((slot) => slot.kind === "group" && slot.row.room.id === "g-work");
    expect(hitl?.kind === "group" && hitl.row.awaitingApproval).toBe(true);
    expect(work?.kind === "group" && work.row.working).toBe(true);
    expect(groupUnreadLabel(buildGroupSidebarRow({ room: room({ id: "g-hitl" }), selected: false, attention }))).toBe(
      "1",
    );
    expect(groupSidebarPreviewLabel(buildGroupSidebarRow({ room: room({ id: "g-hitl" }), selected: false, attention }))).toContain(
      "批准",
    );
    expect(
      groupUnreadLabel(
        buildGroupSidebarRow({
          room: room({ id: "g-work", phase: "holding" }),
          selected: false,
        }),
      ),
    ).toBe("");
  });

  it("renders a group row and stays quiet when members are missing", () => {
    const full = mountGroupItem({
      row: buildGroupSidebarRow({
        room: room({
          id: "g1",
          title: "产品群",
          members: [
            { agentId: "pm", name: "产品" },
            { agentId: "design", name: "设计" },
          ],
          lines: [{ id: "a", role: "user", authorId: "user", text: "做登录", at: 1 }],
        }),
        selected: true,
      }),
      avatars: { pm: "/avatars/pm.webp", design: "/avatars/design.webp" },
    });
    expect(full.textContent).toContain("产品群");
    expect(full.textContent).toContain("做登录");
    const images = [...full.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(images).toEqual(["/avatars/pm.webp", "/avatars/design.webp"]);

    const missing = mountGroupItem({
      row: buildGroupSidebarRow({ room: room({ id: "g2", title: "" }), selected: false }),
    });
    expect(missing.textContent).toContain("还没有消息");
  });

  it("bumps unread only when a non-selected group falls idle after working", () => {
    expect(
      shouldBumpGroupUnread({
        prevPhase: undefined,
        nextPhase: "idle",
        groupId: "g1",
        selectedGroupId: null,
      }),
    ).toBe(false);
    expect(
      shouldBumpGroupUnread({
        prevPhase: "holding",
        nextPhase: "idle",
        groupId: "g1",
        selectedGroupId: "g1",
      }),
    ).toBe(false);
    expect(
      shouldBumpGroupUnread({
        prevPhase: "holding",
        nextPhase: "task",
        groupId: "g1",
        selectedGroupId: null,
      }),
    ).toBe(false);
    expect(
      shouldBumpGroupUnread({
        prevPhase: "task",
        nextPhase: "idle",
        groupId: "g1",
        selectedGroupId: null,
      }),
    ).toBe(true);

    const first = collectGroupUnreadBumps({}, [{ id: "g1", phase: "holding" }], null, "replace");
    expect(first.bumpIds).toEqual([]);
    expect(first.phases).toEqual({ g1: "holding" });

    const done = collectGroupUnreadBumps(first.phases, [{ id: "g1", phase: "idle" }], null, "replace");
    expect(done.bumpIds).toEqual(["g1"]);

    const live = collectGroupUnreadBumps(
      { g1: "holding", g2: "task" },
      [{ id: "g2", phase: "idle" }],
      "g1",
      "merge",
    );
    expect(live.bumpIds).toEqual(["g2"]);
    expect(live.phases).toEqual({ g1: "holding", g2: "idle" });
  });

  it("uses a group unread key that state.json AGENT_ID accepts", () => {
    // 与 runtime state.ts 的 AGENT_ID 对齐；冒号会让 POST /state 400。
    const AGENT_ID = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
    const key = groupUnreadKey("gUnread01");
    expect(key).toBe("group-gUnread01");
    expect(AGENT_ID.test(key)).toBe(true);
    expect(AGENT_ID.test("group:gUnread01")).toBe(false);
  });

  it("pins unread groups and paints the unread badge", () => {
    const unread = { [groupUnreadKey("g-unread")]: 3 };
    const rows = buildConversationRows({
      conversations: [
        card({ agentId: "pa", name: "助理", kind: "personal" }),
        card({ agentId: "dev", name: "开发" }),
      ],
      previews: {},
      lastActiveAt: { pa: 1, dev: 100 },
      selectedId: "",
      busyAgent: "",
      unread: {},
    });
    const slots = mergeSidebarSlots(
      rows,
      [
        room({
          id: "g-unread",
          title: "有未读",
          updatedAt: 1,
          lines: [{ id: "a", role: "user", authorId: "user", text: "旧", at: 1 }],
        }),
      ],
      "",
      { unread },
    );
    expect(slots.map((slot) => (slot.kind === "agent" ? slot.row.agent.agentId : slot.row.room.id))).toEqual([
      "pa",
      "g-unread",
      "dev",
    ]);
    const row = buildGroupSidebarRow({
      room: room({ id: "g-unread" }),
      selected: false,
      unread,
    });
    expect(groupUnreadLabel(row)).toBe("3");

    const view = mountGroupItem({ row });
    expect(view.textContent).toMatch(/3/);
  });

  it("shows working spinner and HITL badge on the group avatar", () => {
    const working = mountGroupItem({
      row: buildGroupSidebarRow({
        room: room({
          id: "g-work",
          title: "忙群",
          phase: "holding",
          lines: [{ id: "a", role: "user", authorId: "user", text: "继续", at: 1 }],
        }),
        selected: false,
      }),
    });
    expect(working.querySelector(".animate-spin")).not.toBeNull();
    expect(working.textContent).toContain("继续");

    const hitl = mountGroupItem({
      row: buildGroupSidebarRow({
        room: room({
          id: "g-hitl",
          title: "待批群",
          phase: "holding",
          lines: [{ id: "a", role: "user", authorId: "user", text: "继续", at: 1 }],
        }),
        selected: false,
        attention: groupAttentionFromSnapshot({ approvals: [{ groupId: "g-hitl" }] }),
      }),
    });
    expect(hitl.querySelector(".animate-spin")).toBeNull();
    expect(hitl.textContent).toMatch(/1/);
    expect(hitl.querySelector("[role='status']")).not.toBeNull();
  });
});
