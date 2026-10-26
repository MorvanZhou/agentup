import { describe, expect, it } from "vitest";

import {
  discoverRecruitedAgents,
  formatAgentSearchRequired,
  formatDiscoveredAgentsContext,
  scoreAgent,
} from "../src/session/delegation/discover.js";
import type { RecruitedAgentInfo } from "../src/session/delegation/types.js";

function card(
  partial: Partial<RecruitedAgentInfo> & Pick<RecruitedAgentInfo, "agentId" | "name">,
): RecruitedAgentInfo {
  return {
    role: "",
    background: "",
    remark: "",
    ...partial,
  };
}

describe("discoverRecruitedAgents", () => {
  it("returns empty for empty roster", () => {
    expect(discoverRecruitedAgents([], "汇率")).toEqual({ agents: [], mode: "empty" });
  });

  it("requires a query instead of dumping a small roster", () => {
    const agents = [
      card({ agentId: "a", name: "甲", role: "律师", background: "合同法" }),
      card({ agentId: "b", name: "乙", role: "会计", background: "税务" }),
    ];
    expect(discoverRecruitedAgents(agents, "")).toEqual({ agents: [], mode: "need_query" });
    expect(discoverRecruitedAgents(agents, "   ")).toEqual({ agents: [], mode: "need_query" });

    const unrelated = discoverRecruitedAgents(agents, "无关话题");
    expect(unrelated.mode).toBe("search");
    expect(unrelated.agents).toEqual([]);
  });

  it("ranks by role and background", () => {
    const agents = Array.from({ length: 10 }, (_, index) =>
      card({
        agentId: `agent-${index}`,
        name: `Agent${index}`,
        role: index === 3 ? "汇率分析师" : "通用助手",
        background: index === 7 ? "专注外汇与跨境结算" : "日常问答",
      }),
    );
    const byRole = discoverRecruitedAgents(agents, "查一下今天汇率");
    expect(byRole.mode).toBe("search");
    expect(byRole.agents[0]?.agentId).toBe("agent-3");
    expect(byRole.truncated).toBe(false);

    const byBackground = discoverRecruitedAgents(agents, "跨境结算怎么办");
    expect(byBackground.agents[0]?.agentId).toBe("agent-7");
  });

  it("truncates to topK when many agents match", () => {
    const agents = Array.from({ length: 8 }, (_, index) =>
      card({
        agentId: `fx-${index}`,
        name: `汇${index}`,
        role: "汇率分析师",
        background: "外汇",
      }),
    );
    const result = discoverRecruitedAgents(agents, "汇率");
    expect(result.mode).toBe("search");
    expect(result.agents).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });

  it("scores systemText as fallback corpus", () => {
    const agent = card({
      agentId: "weather",
      name: "weather",
      systemText: "你是天气助手。岗位：气象顾问。\n\n擅长本地天气预报。",
    });
    expect(scoreAgent(agent, "气象")).toBeGreaterThan(0);
    expect(scoreAgent(agent, "天气预报")).toBeGreaterThan(0);
  });

  it("scores AGENTS.md work rules when the card itself does not match", () => {
    const agent = card({
      agentId: "cody",
      name: "Cody",
      role: "软件功能实现",
      background: "依据 brief 交付可运行改动",
      agentsText: "主责：在工作区实现可运行改动。范围不清时先找需求澄清。",
    });
    expect(scoreAgent(agent, "我要开发一个走迷宫的小游戏")).toBe(0);
    expect(scoreAgent(agent, "需求澄清")).toBeGreaterThan(0);
    const found = discoverRecruitedAgents(
      [agent, card({ agentId: "amy", name: "Amy", role: "汇率员" })],
      "需求澄清",
    );
    expect(found.agents.map((item) => item.agentId)).toEqual(["cody"]);
  });
});

describe("formatAgentSearchRequired", () => {
  it("tells the assistant to search when nothing lexical matched", () => {
    const text = formatAgentSearchRequired();
    expect(text).toContain("Roster search");
    expect(text).toContain("Call agent_search");
    expect(text).toContain("before ask_user");
  });
});

describe("formatDiscoveredAgentsContext", () => {
  it("returns empty when there is nothing to inject", () => {
    expect(formatDiscoveredAgentsContext({ mode: "empty", agents: [] })).toBe("");
    expect(formatDiscoveredAgentsContext({ mode: "need_query", agents: [] })).toBe("");
    expect(formatDiscoveredAgentsContext({ mode: "search", agents: [] })).toBe("");
  });

  it("formats cards and points at agent_search", () => {
    const text = formatDiscoveredAgentsContext({
      mode: "search",
      agents: [
        card({
          agentId: "fx",
          name: "汇率通",
          role: "汇率分析师",
          background: "外汇与跨境结算",
          remark: "小汇",
        }),
      ],
      truncated: true,
    });
    expect(text).toContain("Relevant recruited agents");
    expect(text).toContain("not an agent_search result");
    expect(text).toContain("Call agent_search");
    expect(text).toContain("Stay inside your own role");
    expect(text).toContain("ask the user who should do the work");

    expect(text).toContain("Do not silently self-serve");
    expect(text).toContain("agent_search");
    expect(text).toContain("小汇");
    expect(text).toContain("agent_id: fx");
    expect(text).toContain("汇率分析师");
    expect(text).toContain("外汇与跨境结算");
    expect(text).toContain("More agents available");
  });
});

