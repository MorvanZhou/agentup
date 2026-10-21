import type { RecruitedAgentInfo } from "./types.js";

/** 花名册不超过此数时全量注入，不做裁剪。 */
export const DISCOVER_SMALL_ROSTER = 8;
/** 大花名册检索返回条数。 */
export const DISCOVER_TOP_K = 5;

export type DiscoverMode = "empty" | "all" | "search" | "sample";

export type DiscoverResult = {
  agents: RecruitedAgentInfo[];
  mode: DiscoverMode;
  /** 是否还有更多未返回。 */
  truncated?: boolean;
};

/**
 * 在已招募花名册上按姓名 / 职业 / 背景 / 备注 / SYSTEM 词法打分，取 Top-K。
 * 小花名册（≤8）全量返回。
 */
export function discoverRecruitedAgents(
  agents: readonly RecruitedAgentInfo[],
  query: string,
  options: { topK?: number; smallLimit?: number } = {},
): DiscoverResult {
  const topK = options.topK ?? DISCOVER_TOP_K;
  const smallLimit = options.smallLimit ?? DISCOVER_SMALL_ROSTER;
  if (agents.length === 0) return { agents: [], mode: "empty" };

  if (agents.length <= smallLimit) {
    return { agents: [...agents], mode: "all" };
  }

  const q = query.trim();
  if (!q) {
    return {
      agents: agents.slice(0, topK),
      mode: "sample",
      truncated: agents.length > topK,
    };
  }

  const ranked = agents
    .map((agent) => ({ agent, score: scoreAgent(agent, q) }))
    .filter((row) => row.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.agent.name.localeCompare(b.agent.name, "en") ||
        a.agent.agentId.localeCompare(b.agent.agentId, "en"),
    );

  return {
    agents: ranked.slice(0, topK).map((row) => row.agent),
    mode: "search",
    truncated: ranked.length > topK,
  };
}

/** 词法打分：子串命中加权，否则按 token 命中累加。 */
export function scoreAgent(agent: RecruitedAgentInfo, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const fields: Array<[string, number]> = [
    [agent.name, 3],
    [agent.role, 3],
    [agent.remark, 2],
    [agent.background, 2],
    [agent.systemText ?? "", 1],
  ];
  const tokens = tokenize(q);
  let total = 0;
  for (const [text, weight] of fields) {
    const hay = text.trim().toLowerCase();
    if (!hay) continue;
    if (hay.includes(q)) {
      total += weight * 10;
      continue;
    }
    for (const token of tokens) {
      if (token.length >= 1 && hay.includes(token)) total += weight;
    }
  }
  return total;
}

/** 拼进每轮模型上下文的候选专家块；无候选时返回空串。 */
export function formatDiscoveredAgentsContext(result: DiscoverResult): string {
  if (result.agents.length === 0) {
    if (result.mode === "empty") return "";
    return [
      "# Relevant recruited agents",
      "",
      "No matching specialists for this turn. Call list_recruited_agents with a different query, or answer yourself.",
    ].join("\n");
  }

  const lines = result.agents.map(formatAgentCardLine);
  const footer =
    result.truncated && result.mode !== "all"
      ? "\n\n(More agents available — call list_recruited_agents with a query to refine.)"
      : "";

  return [
    "# Relevant recruited agents",
    "",
    "Candidates from the user's contact list (local private + market recruited). When a specialist's role or background fits the task, prefer list_recruited_agents / delegate_to_agent (user approval required). You keep ownership of the user-facing reply.",
    "",
    ...lines,
  ].join("\n") + footer;
}

/** 工具 / 日志用的单行名片。 */
export function formatAgentCardLine(agent: RecruitedAgentInfo): string {
  const label = (agent.remark || agent.name).trim() || agent.agentId;
  const role = agent.role.trim() || "（无岗位）";
  const background = agent.background.trim() || "（无背景）";
  return `- ${label} (agent_id: ${agent.agentId}): ${role} — ${background}`;
}

/** 空白分词 + 连续字串的 bigram（利于中文「查一下今天汇率」命中「汇率」）。 */
function tokenize(query: string): string[] {
  const tokens = new Set<string>();
  for (const part of query.split(/[^\p{L}\p{N}]+/u)) {
    const lower = part.trim().toLowerCase();
    if (!lower) continue;
    tokens.add(lower);
    const chars = [...lower];
    if (chars.length >= 2) {
      for (let i = 0; i < chars.length - 1; i++) {
        tokens.add(`${chars[i]}${chars[i + 1]}`);
      }
    }
  }
  return [...tokens];
}
