import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

import type { ModelConfig } from "../../config/load.js";
import { resolveModelLimits } from "../../config/model-catalog.js";
import { getProviderTemplate } from "../../config/provider-templates.js";

/** 会话 custom entry：本轮助手回复所用的 provider / 模型。 */
export const AGENTUP_REPLY_MODEL_CUSTOM_TYPE = "agentup-reply-model";

export type AgentUpReplyModel = {
  templateId: string;
  modelId: string;
  /** Desktop ProviderLogo 用的厂商 id */
  vendorId: string;
  /** 展示用模型名（非 id）；UI hover 只显示这个 */
  modelLabel: string;
};

/** 从 templateId + modelId 抽出展示快照（不含密钥）。 */
export function replyModelFromRef(
  ref: { templateId?: string; modelId?: string; providerId?: string },
  userDataRoot = "",
): AgentUpReplyModel {
  // 测例 / 残缺 ModelConfig 可能缺字段；trim 前先落空串，避免整轮 turn 未起就炸。
  const templateId = typeof ref.templateId === "string" ? ref.templateId.trim() : "";
  const modelId = typeof ref.modelId === "string" ? ref.modelId.trim() : "";
  const template = templateId ? getProviderTemplate(templateId) : undefined;
  const rawVendor =
    template?.vendorId ??
    (typeof ref.providerId === "string" ? ref.providerId : undefined) ??
    templateId;
  const vendorId =
    (typeof rawVendor === "string" ? rawVendor.trim() : "") || templateId || modelId;
  // 目录缓存优先，再回落模板内置名，避免只露出 modelId。
  const named = resolveModelLimits(userDataRoot, templateId, modelId).name.trim();
  return {
    templateId: templateId || modelId,
    modelId: modelId || templateId,
    vendorId,
    modelLabel: named || modelId || templateId,
  };
}

/** 从本机 ModelConfig 抽出可落盘的回复模型快照（不含密钥）。 */
export function replyModelFromConfig(
  model: ModelConfig,
  userDataRoot = "",
): AgentUpReplyModel {
  return replyModelFromRef(
    {
      templateId: model.templateId,
      modelId: model.modelId,
      providerId: model.providerId,
    },
    userDataRoot,
  );
}

export function parseReplyModelEntryData(data: unknown): AgentUpReplyModel | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as {
    templateId?: unknown;
    modelId?: unknown;
    vendorId?: unknown;
    modelLabel?: unknown;
  };
  const templateId = typeof record.templateId === "string" ? record.templateId.trim() : "";
  const modelId = typeof record.modelId === "string" ? record.modelId.trim() : "";
  if (!templateId || !modelId) return undefined;
  const vendorId =
    typeof record.vendorId === "string" && record.vendorId.trim()
      ? record.vendorId.trim()
      : templateId;
  const modelLabel =
    typeof record.modelLabel === "string" && record.modelLabel.trim()
      ? record.modelLabel.trim()
      : modelId;
  return {
    templateId,
    modelId,
    vendorId,
    modelLabel,
  };
}

/**
 * turn settled 后写入本轮回复模型；供流式投影与历史还原。
 * 闭包拿打开会话时的 ModelConfig（同 modelKey 下 templateId/modelId 不变）。
 */
export function createReplyModelExtension(
  model: ModelConfig,
  userDataRoot = "",
): ExtensionFactory {
  const snapshot = replyModelFromConfig(model, userDataRoot);
  return (pi) => {
    pi.on("agent_settled", async () => {
      pi.appendEntry<AgentUpReplyModel>(AGENTUP_REPLY_MODEL_CUSTOM_TYPE, snapshot);
    });
  };
}
