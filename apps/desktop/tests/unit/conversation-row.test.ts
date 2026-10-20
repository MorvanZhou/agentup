import { expect, it } from "vitest";

import {
  AWAITING_APPROVAL_PREVIEW,
  AWAITING_ASK_USER_PREVIEW,
  buildConversationRows,
  conversationDisplayName,
  conversationPreviewLabel,
  filterConversationRows,
  hasRecruitedMarketAgent,
  totalUnread,
  unreadLabel,
} from "../../src/pages/conversation/model/conversation-row.js";
import type { AgentCard } from "../../src/shared/model/runtime.js";

function card(partial: Partial<AgentCard> & Pick<AgentCard, "agentId" | "name">): AgentCard {
  return {
    summary: "",
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

it("joins agent meta with cached previews and UI flags into one row", () => {
  const rows = buildConversationRows({
    conversations: [
      card({ agentId: "a", name: "天气", summary: "日报", remark: "小天气", latestVersion: 2, localVersion: 1 }),
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
    conversationPreviewLabel({ awaitingApproval: true, awaitingAskUser: false, preview: "花了 20" }),
  ).toBe(AWAITING_APPROVAL_PREVIEW);
  expect(
    conversationPreviewLabel({ awaitingApproval: false, awaitingAskUser: false, preview: "" }),
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
    conversationPreviewLabel({ awaitingApproval: false, awaitingAskUser: true, preview: "花了 20" }),
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

it("orders rows by lastActiveAt like WeChat chat list", () => {
  const rows = buildConversationRows({
    conversations: [
      card({ agentId: "a", name: "天气" }),
      card({ agentId: "b", name: "记账" }),
      card({ agentId: "c", name: "翻译" }),
    ],
    previews: { a: "晴", b: "花了 20" },
    lastActiveAt: { a: 10, b: 30 },
    selectedId: "",
    busyAgent: "",
    unread: {},
  });
  expect(rows.map((row) => row.agent.agentId)).toEqual(["b", "a", "c"]);
});

it("filters rows by precomputed searchText", () => {
  const rows = buildConversationRows({
    conversations: [
      card({ agentId: "a", name: "天气助手", summary: "预报" }),
      card({ agentId: "b", name: "记账", summary: "开销", remark: "日常账本" }),
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
