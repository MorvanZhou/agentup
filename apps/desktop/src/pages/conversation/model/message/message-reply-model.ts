/** 与 runtime `agentUpReplyModel` 对齐：本轮助手回复所用的 provider / 模型。 */
export type AgentUpReplyModel = {
  templateId: string;
  modelId: string;
  vendorId: string;
  /** 展示用模型名；缺省时 UI 仍不展示 id，回落空串由调用方隐藏。 */
  modelLabel?: string;
};

export function readAgentUpReplyModel(metadata: unknown): AgentUpReplyModel | null {
  if (!metadata || typeof metadata !== "object") return null;
  const custom = (metadata as { custom?: unknown }).custom;
  const raw =
    custom && typeof custom === "object"
      ? (custom as { agentUpReplyModel?: unknown }).agentUpReplyModel
      : (metadata as { agentUpReplyModel?: unknown }).agentUpReplyModel;
  if (!raw || typeof raw !== "object") return null;
  const record = raw as {
    templateId?: unknown;
    modelId?: unknown;
    vendorId?: unknown;
    modelLabel?: unknown;
  };
  const templateId = typeof record.templateId === "string" ? record.templateId.trim() : "";
  const modelId = typeof record.modelId === "string" ? record.modelId.trim() : "";
  if (!templateId || !modelId) return null;
  const vendorId =
    typeof record.vendorId === "string" && record.vendorId.trim()
      ? record.vendorId.trim()
      : templateId;
  const modelLabel =
    typeof record.modelLabel === "string" && record.modelLabel.trim()
      ? record.modelLabel.trim()
      : undefined;
  return {
    templateId,
    modelId,
    vendorId,
    ...(modelLabel ? { modelLabel } : {}),
  };
}

/**
 * 气泡旁展示的模型名：只用 modelLabel。
 * 旧消息没有 modelLabel 时不回落 modelId（避免把 id 当名字秀出来）。
 */
export function replyModelDisplayName(model: AgentUpReplyModel): string {
  return model.modelLabel?.trim() || "";
}

/** 从消息列表里取最近一条助手的本轮模型快照。 */
export function replyModelFromMessages(
  messages: readonly { role?: string; metadata?: unknown }[],
): AgentUpReplyModel | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const model = readAgentUpReplyModel(message.metadata);
    if (model) return model;
  }
  return null;
}
