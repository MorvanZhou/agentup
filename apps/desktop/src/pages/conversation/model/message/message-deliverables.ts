/** 与 runtime `agentUpDeliverables` 对齐：收口气泡下方的交付附件网格。 */

export type AgentUpDeliverable = {
  path: string;
  size?: number;
};

export type AgentUpDeliverables = {
  files: AgentUpDeliverable[];
  curated?: boolean;
};

/** 从 UIMessage.metadata 读出本回合交付清单。 */
export function readAgentUpDeliverables(metadata: unknown): AgentUpDeliverables | null {
  if (!metadata || typeof metadata !== "object") return null;
  const custom = (metadata as { custom?: unknown }).custom;
  const raw =
    custom && typeof custom === "object"
      ? (custom as { agentUpDeliverables?: unknown }).agentUpDeliverables
      : (metadata as { agentUpDeliverables?: unknown }).agentUpDeliverables;
  return parseAgentUpDeliverables(raw);
}

export function parseAgentUpDeliverables(raw: unknown): AgentUpDeliverables | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { files?: unknown }).files;
  if (!Array.isArray(list)) return null;
  const files: AgentUpDeliverable[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as { path?: unknown; size?: unknown };
    if (typeof record.path !== "string" || !record.path.startsWith("ARTIFACT/")) continue;
    const entry: AgentUpDeliverable = { path: record.path };
    if (typeof record.size === "number" && Number.isFinite(record.size) && record.size >= 0) {
      entry.size = record.size;
    }
    files.push(entry);
  }
  const curated = (raw as { curated?: unknown }).curated === true;
  if (files.length === 0 && !curated) return null;
  return curated ? { files, curated: true } : { files };
}

/** 展示用文件名（最后一段）。 */
export function deliverableFileName(filePath: string): string {
  const trimmed = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = trimmed.split("/").pop() ?? trimmed;
  return base || filePath;
}
