import { expect, it } from "vitest";

import {
  AWAITING_APPROVAL_PREVIEW,
  AWAITING_ASK_USER_PREVIEW,
  attentionBadgeCount,
  buildConversationRows,
  childHitlHintsFromAttention,
  conversationDisplayName,
  conversationPreviewLabel,
  delegationPreviewText,
  filterConversationRows,
  hasRecruitedMarketAgent,
  menuBarAttentionCount,
  totalAttentionBadge,
  totalBlocked,
  totalUnread,
  unreadLabel,
} from "../../src/pages/conversation/model/sidebar/conversation-row.js";
import type { AgentCard } from "../../src/shared/model/runtime/runtime.js";

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

it("shows who assigned a single delegated task, without pinning or stealing unread", () => {
  const rows = buildConversationRows({
    conversations: [
      card({ agentId: "pm", name: "产品经理", kind: "recruited" }),
      card({ agentId: "fe", name: "前端", remark: "小前", kind: "recruited" }),
      card({ agentId: "old", name: "旧会话", kind: "recruited" }),
    ],
    previews: { pm: "父预览", fe: "子预览", old: "有未读" },
    lastActiveAt: { pm: 100, fe: 20, old: 1 },
    selectedId: "",
    busyAgent: "",
    unread: { old: 2 },
    delegationPresence: {
      dispatchedCount: { pm: 1 },
      incoming: {
        fe: [{ id: "t1", fromAgentId: "pm", brief: "改登录页", createdAt: 1 }],
      },
    },
    resolveAgentName: (id) => (id === "pm" ? "产品经理" : id),
  });
  const fe = rows.find((row) => row.agent.agentId === "fe")!;
  const pm = rows.find((row) => row.agent.agentId === "pm")!;
  expect(fe).toMatchObject({
    incomingCount: 1,
    incomingFromName: "产品经理",
    dispatchedCount: 0,
    working: false,
    unread: 0,
  });
  expect(pm).toMatchObject({ dispatchedCount: 1, incomingCount: 0, working: false });
  expect(conversationPreviewLabel(fe)).toBe("在做 产品经理 派的活");
  expect(conversationPreviewLabel(pm)).toBe("已派出 1 人");
  expect(attentionBadgeCount(fe)).toBe(0);
  expect(rows.map((row) => row.agent.agentId)).toEqual(["old", "pm", "fe"]);
  expect(fe.searchText).toContain("产品经理");
});

it("collapses several incoming tasks and lets direct HITL replace the delegation line", () => {
  expect(
    delegationPreviewText({ incomingCount: 2, incomingFromName: "产品经理", dispatchedCount: 3 }),
  ).toBe("2 项委托进行中");
  expect(
    delegationPreviewText({ incomingCount: 1, incomingFromName: "", dispatchedCount: 0 }),
  ).toBe("在做派来的活");
  expect(
    delegationPreviewText({ incomingCount: 0, incomingFromName: "", dispatchedCount: 2 }),
  ).toBe("已派出 2 人");
  expect(
    conversationPreviewLabel({
      awaitingApproval: true,
      awaitingAskUser: false,
      ...emptyChild,
      preview: "子预览",
      incomingCount: 1,
      incomingFromName: "产品经理",
      dispatchedCount: 4,
    }),
  ).toBe(AWAITING_APPROVAL_PREVIEW);
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

it("merges HITL into attention badge count with unread", () => {
  expect(
    attentionBadgeCount({ unread: 0, awaitingApproval: false, awaitingAskUser: false }),
  ).toBe(0);
  expect(
    attentionBadgeCount({ unread: 3, awaitingApproval: false, awaitingAskUser: false }),
  ).toBe(3);
  expect(
    attentionBadgeCount({ unread: 0, awaitingApproval: true, awaitingAskUser: false }),
  ).toBe(1);
  expect(
    attentionBadgeCount({ unread: 0, awaitingApproval: false, awaitingAskUser: true }),
  ).toBe(1);
  expect(
    attentionBadgeCount({ unread: 2, awaitingApproval: true, awaitingAskUser: false }),
  ).toBe(3);
  expect(
    attentionBadgeCount({ unread: 2, awaitingApproval: true, awaitingAskUser: true }),
  ).toBe(3);
  expect(
    attentionBadgeCount({ unread: 1.8, awaitingApproval: false, awaitingAskUser: false }),
  ).toBe(1);
});

it("sums unread across agents", () => {
  expect(totalUnread({})).toBe(0);
  expect(totalUnread({ a: 3, b: 2 })).toBe(5);
  expect(totalUnread({ a: 0, b: -1, c: 1.8 })).toBe(1);
});

it("sums approvals and unread for the menu bar count", () => {
  expect(menuBarAttentionCount(0, 0)).toBe(0);
  expect(menuBarAttentionCount(1, 0)).toBe(1);
  expect(menuBarAttentionCount(0, 4)).toBe(4);
  expect(menuBarAttentionCount(2, 3)).toBe(5);
  expect(menuBarAttentionCount(1.8, 1.2)).toBe(2);
  expect(menuBarAttentionCount(-1, Number.NaN)).toBe(0);
});

it("matches the sum of conversation-list attention badges for the main nav", () => {
  // 同会话：1 未读 + 1 HITL → 列表角标 2，主导航也应是 2（不是只显示 blocked=1）
  expect(totalAttentionBadge({ a: 1 }, ["a"], [])).toBe(2);
  expect(totalAttentionBadge({ a: 2 }, [], [])).toBe(2);
  expect(totalAttentionBadge({ a: 2, b: 1 }, ["b"], ["c"])).toBe(5);
  // 同一 agent 同时审批+提问只 +1；子 HITL 父会话提醒不计入（与 attentionBadgeCount 一致）
  expect(totalAttentionBadge({ a: 1 }, ["a"], ["a"])).toBe(2);
  expect(totalAttentionBadge({}, [], [])).toBe(0);
});

it("counts blocked agents once even if both approval and ask_user", () => {
  expect(totalBlocked([], [])).toBe(0);
  expect(totalBlocked(["a", "b"], ["b", "c"])).toBe(3);
  expect(totalBlocked(new Set(["a"]), new Set(["a"]))).toBe(1);
  expect(totalBlocked(["child"], [], ["parent"])).toBe(2);
});

it("labels the follow-up session with the specialist who is waiting", () => {
  const hints = childHitlHintsFromAttention({
    approvals: [{ agentId: "pm", originAgentId: "fe", parentAgentId: "pm", askedByName: "前端" }],
    askUsers: [{ agentId: "pm", originAgentId: "be", parentAgentId: "pm" }],
    resolveName: (id) => (id === "be" ? "后端" : id),
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
