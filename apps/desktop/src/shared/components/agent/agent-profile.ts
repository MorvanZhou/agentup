import type { AgentCard } from "../../model/runtime/runtime";

/** 资料弹窗场景：决定底部 CTA。 */
export type AgentProfileScene =
  | "market"
  | "recruited"
  | "local"
  | "personal"
  | "published"
  | "readonly";

/** 展示名：有备注用备注，否则真名。 */
export function agentDisplayName(agent: Pick<AgentCard, "name" | "remark">): string {
  const remark = agent.remark?.trim() ?? "";
  return remark || agent.name;
}

/** 有备注时回传真名，供标题下副行显示。 */
export function agentRealNameLine(agent: Pick<AgentCard, "name" | "remark">): string {
  const remark = agent.remark?.trim() ?? "";
  if (!remark) return "";
  const name = agent.name?.trim() ?? "";
  return name && name !== remark ? name : "";
}

/** 按 kind / recruited 推断场景；显式 scene 优先。 */
export function inferAgentProfileScene(
  agent: Pick<AgentCard, "kind" | "recruited">,
  scene?: AgentProfileScene,
): AgentProfileScene {
  if (scene) return scene;
  if (agent.kind === "personal") return "personal";
  if (agent.kind === "local") return "local";
  if (agent.recruited) return "recruited";
  if (agent.kind === "recruited") return "market";
  return "readonly";
}

/** 聊天/群成员缺字段时拼一张可开资料的名片。 */
export function stubAgentCard(input: {
  agentId: string;
  name: string;
  role?: string;
  remark?: string;
  background?: string;
  avatarUrl?: string;
  kind?: AgentCard["kind"];
  recruited?: boolean;
}): AgentCard {
  return {
    kind: input.kind,
    agentId: input.agentId,
    name: input.name.trim() || input.agentId,
    role: input.role?.trim() ?? "",
    background: input.background?.trim() ?? "",
    remark: input.remark?.trim() ?? "",
    avatarUrl: input.avatarUrl,
    hasAvatar: Boolean(input.avatarUrl),
    latestVersion: 0,
    latestDigest: "",
    localVersion: 0,
    recruited: input.recruited ?? (input.kind === "recruited" || input.kind === "personal"),
    recruitCount: 0,
    createdAt: "",
    updatedAt: "",
  };
}
