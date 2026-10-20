/**
 * 需账号能力表：唯一策略源。
 *
 * 不在表内的能力默认游客可用，例如：
 * - 用自备本地模型 / Provider Key 发送与重发
 * - 浏览市场、配置外观 / Provider、改写本机私人助理 / Skills / MCP
 *
 * 新增需登录触点：先在此加一行，再在动词上包 `runWithAccount`。
 */

export type CapabilityId = "agent.publish" | "agent.recruit" | "chat.useHostedModel";

export type CapabilityDef = {
  /** i18n key：拦下时给用户看的原因 */
  reasonKey: string;
};

export const CAPABILITIES: Record<CapabilityId, CapabilityDef> = {
  "agent.publish": { reasonKey: "authReasonPublish" },
  "agent.recruit": { reasonKey: "authReasonRecruit" },
  "chat.useHostedModel": { reasonKey: "authReasonHostedModel" },
};

/** 平台托管模型的 Provider template.kind；出现后再接到选模与发送闸门。 */
export const HOSTED_PROVIDER_KIND = "agentup";

export function isHostedProviderKind(kind: string | undefined | null): boolean {
  return kind === HOSTED_PROVIDER_KIND;
}

export function capabilityReasonKey(id: CapabilityId): string {
  return CAPABILITIES[id].reasonKey;
}
