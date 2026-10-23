/** 主会话当前回合阶段（供 attention / 编排条）。 */
export type BusyTurnPhase = "prompt" | "wake";

/** wake 触发来源（委托 / 后台作业摘要）。 */
export type BusyTurnSource = {
  name: string;
  status?: string;
  agentId?: string;
  kind?: "delegation" | "background";
};

export type BusyTurnInfo = {
  agentId: string;
  phase: BusyTurnPhase;
  sources: BusyTurnSource[];
};

/** 从 async_wake details.items 抽出展示用来源。 */
export function wakeSourcesFromDetails(details: { items?: unknown[] } | unknown): BusyTurnSource[] {
  if (!details || typeof details !== "object") return [];
  const items = (details as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: BusyTurnSource[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const name =
      (typeof item.toAgentName === "string" && item.toAgentName.trim()) ||
      (typeof item.name === "string" && item.name.trim()) ||
      (typeof item.toAgentId === "string" && item.toAgentId.trim()) ||
      "";
    if (!name && typeof item.id !== "string") continue;
    const custom =
      typeof item.customType === "string" ? item.customType : "";
    const kind: BusyTurnSource["kind"] = /background/i.test(custom)
      ? "background"
      : "delegation";
    out.push({
      name: name || String(item.id ?? "").slice(0, 8) || "task",
      status: typeof item.status === "string" ? item.status : undefined,
      agentId: typeof item.toAgentId === "string" ? item.toAgentId : undefined,
      kind,
    });
  }
  return out;
}
