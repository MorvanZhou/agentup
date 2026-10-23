import { expect, it } from "vitest";

import {
  AWAITING_APPROVAL_PREVIEW,
  AWAITING_ASK_USER_PREVIEW,
  buildConversationRows,
  childHitlHintsFromAttention,
  conversationDisplayName,
  conversationPreviewLabel,
  filterConversationRows,
  hasRecruitedMarketAgent,
  totalBlocked,
  totalUnread,
  unreadLabel,
} from "../../src/pages/conversation/model/sidebar/conversation-row.js";
import type { AgentCard } from "../../src/shared/model/runtime.js";

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
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

const emptyChild = {
  awaitingChildHitl: false,
  childHitlName: "",
  childHitlKind: "" as const,
};

it("joins agent meta with cached previews and UI flags into one row", () => {
  const rows = buildConversationRows({
    conversations: [
      card({ agentId: "a", name: "天气", background: "日报", remark: "小天气", latestVersion: 2, localVersion: 1 }),
    ],
    previews: { a: "明天 晴吗" },
    lastActiveAt: { a: 100 },
    selectedId: "a",
    busyAgent: "",
    unread: { a: 3 },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    preview: "明天 晴吗",
    selected: true,
    busy: false,
    awaitingApproval: false,
    awaitingAskUser: false,
    awaitingChildHitl: false,
    working: false,
    unread: 3,
    hasUpdate: true,
    lastActiveAt: 100,
  });
  expect(conversationDisplayName(rows[0]!)).toBe("小天气");
  expect(rows[0]!.searchText).toContain("小天气");
  expect(rows[0]!.searchText).toContain("天气");
  expect(rows[0]!.searchText).toContain("明天 晴吗");
});

it("marks rows awaiting approval and prefers that preview label", () => {
  const rows = buildConversationRows({
    conversations: [
      card({ agentId: "a", name: "天气" }),
      card({ agentId: "b", name: "记账" }),
    ],
    previews: { a: "明天晴吗", b: "花了 20" },
    lastActiveAt: {},
    selectedId: "",
    busyAgent: "",
    unread: {},
    awaitingApproval: ["b"],
  });
  expect(rows.find((row) => row.agent.agentId === "a")?.awaitingApproval).toBe(false);
  expect(rows.find((row) => row.agent.agentId === "b")?.awaitingApproval).toBe(true);
  expect(
    conversationPreviewLabel({
      awaitingApproval: true,
      awaitingAskUser: false,
      ...emptyChild,
      preview: "花了 20",
    }),
  ).toBe(AWAITING_APPROVAL_PREVIEW);
  expect(
    conversationPreviewLabel({
      awaitingApproval: false,
      awaitingAskUser: false,
      ...emptyChild,
      preview: "",
    }),
  ).toBe("暂无消息");
});

it("marks rows awaiting ask_user and prefers that preview label", () => {
  const rows = buildConversationRows({
    conversations: [
      card({ agentId: "a", name: "天气" }),
      card({ agentId: "b", name: "记账" }),
    ],
    previews: { a: "明天晴吗", b: "花了 20" },
    lastActiveAt: {},
    selectedId: "",
    busyAgent: "",
    unread: {},
    awaitingAskUser: ["b"],
  });
  expect(rows.find((row) => row.agent.agentId === "a")?.awaitingAskUser).toBe(false);
  expect(rows.find((row) => row.agent.agentId === "b")?.awaitingAskUser).toBe(true);
  expect(
    conversationPreviewLabel({
      awaitingApproval: false,
      awaitingAskUser: true,
      ...emptyChild,
      preview: "花了 20",
    }),
  ).toBe(AWAITING_ASK_USER_PREVIEW);
});

it("marks rows whose Agent turn is still working", () => {
  const rows = buildConversationRows({
    conversations: [
      card({ agentId: "a", name: "天气" }),
      card({ agentId: "b", name: "记账" }),
    ],
    previews: {},
    lastActiveAt: {},
    selectedId: "",
    busyAgent: "",
    unread: { a: 2 },
    working: ["a"],
  });
  expect(rows.find((row) => row.agent.agentId === "a")?.working).toBe(true);
  expect(rows.find((row) => row.agent.agentId === "b")?.working).toBe(false);
});

it("keeps personal assistant first, then pins approval/unread ahead of lastActiveAt", () => {
  const rows = buildConversationRows({
    conversations: [
      card({ agentId: "weather", name: "天气", kind: "recruited" }),
      card({ agentId: "ledger", name: "记账", kind: "recruited" }),
      card({ agentId: "personal-assistant", name: "助理", kind: "personal" }),
      card({ agentId: "idle", name: "闲置", kind: "recruited" }),
    ],
    previews: {},
    lastActiveAt: { weather: 50, ledger: 10, "personal-assistant": 1, idle: 99 },
    selectedId: "",
    busyAgent: "",
    unread: { weather: 1 },
    awaitingApproval: ["ledger"],
  });
  expect(rows.map((row) => row.agent.agentId)).toEqual([
    "personal-assistant",
    "ledger",
    "weather",
    "idle",
  ]);
});

it("pins parent with child HITL reminder after direct HITL and before unread", () => {
  const rows = buildConversationRows({
    conversations: [
      card({ agentId: "pm", name: "项目经理", kind: "recruited" }),
      card({ agentId: "fe", name: "前端", kind: "recruited" }),
      card({ agentId: "old", name: "旧会话", kind: "recruited" }),
    ],
    previews: {},
    lastActiveAt: { pm: 1, fe: 2, old: 100 },
    selectedId: "",
    busyAgent: "",
    unread: { old: 2 },
    awaitingApproval: ["fe"],
    childHitlByParent: {
      pm: { name: "前端", kind: "approval" },
    },
  });
  expect(rows.map((row) => row.agent.agentId)).toEqual(["fe", "pm", "old"]);
  expect(rows.find((row) => row.agent.agentId === "pm")).toMatchObject({
    awaitingChildHitl: true,
    childHitlName: "前端",
    childHitlKind: "approval",
  });
  expect(
    conversationPreviewLabel({
      awaitingApproval: false,
      awaitingAskUser: false,
      awaitingChildHitl: true,
      childHitlName: "前端",
      childHitlKind: "approval",
      preview: "闲聊",
    }),
  ).toBe("「前端」等待你的批准");
});

it("filters rows by precomputed searchText", () => {
  const rows = buildConversationRows({
    conversations: [
      card({ agentId: "a", name: "天气助手", background: "预报" }),
      card({ agentId: "b", name: "记账", background: "开销", remark: "日常账本" }),
    ],
    previews: { b: "买菜花了 20" },
    lastActiveAt: {},
    selectedId: "",
    busyAgent: "",
    unread: {},
  });
  expect(filterConversationRows(rows, "天气").map((row) => row.agent.agentId)).toEqual(["a"]);
  expect(filterConversationRows(rows, "买菜").map((row) => row.agent.agentId)).toEqual(["b"]);
  expect(filterConversationRows(rows, "日常账本").map((row) => row.agent.agentId)).toEqual(["b"]);
  expect(filterConversationRows(rows, "  ").map((row) => row.agent.agentId)).toEqual(["a", "b"]);
});

it("falls back to agent name when remark is empty", () => {
  const rows = buildConversationRows({
    conversations: [card({ agentId: "a", name: "天气" })],
    previews: {},
    lastActiveAt: {},
    selectedId: "",
    busyAgent: "",
    unread: {},
  });
  expect(conversationDisplayName(rows[0]!)).toBe("天气");
});

it("formats unread badges", () => {
  expect(unreadLabel(0)).toBe("");
  expect(unreadLabel(3)).toBe("3");
  expect(unreadLabel(12)).toBe("9+");
});

it("sums unread across agents", () => {
  expect(totalUnread({})).toBe(0);
  expect(totalUnread({ a: 3, b: 2 })).toBe(5);
  expect(totalUnread({ a: 0, b: -1, c: 1.8 })).toBe(1);
});

it("counts blocked agents once even if both approval and ask_user", () => {
  expect(totalBlocked([], [])).toBe(0);
  expect(totalBlocked(["a", "b"], ["b", "c"])).toBe(3);
  expect(totalBlocked(new Set(["a"]), new Set(["a"]))).toBe(1);
  expect(totalBlocked(["child"], [], ["parent"])).toBe(2);
});

it("builds child HITL hints only when surfaced on child (async)", () => {
  const hints = childHitlHintsFromAttention({
    approvals: [
      { agentId: "fe", originAgentId: "fe", parentAgentId: "pm" },
      { agentId: "pm", originAgentId: "be", parentAgentId: "pm" },
    ],
    askUsers: [],
    resolveName: (id) => (id === "fe" ? "前端" : id),
  });
  expect([...hints.entries()]).toEqual([["pm", { kind: "approval", name: "前端" }]]);
});

it("treats only personal assistant as no market recruits", () => {
  expect(hasRecruitedMarketAgent([])).toBe(false);
  expect(hasRecruitedMarketAgent([{ agentId: "personal-assistant", kind: "personal" }])).toBe(false);
  expect(
    hasRecruitedMarketAgent([
      { agentId: "personal-assistant", kind: "personal" },
      { agentId: "weather", kind: "recruited" },
    ]),
  ).toBe(true);
  expect(hasRecruitedMarketAgent([{ agentId: "weather" }])).toBe(true);
});
