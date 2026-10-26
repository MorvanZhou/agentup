import { hitlOriginOf, type HitlOrigin } from "./origin.js";

/**
 * 嵌套委托 HITL 的展示归属：
 * `origin=delegation` 一律挂到负责跟进的父会话（父是否空闲都一样），不挂子会话。
 * 用户与同一 agent 的直聊 HITL（origin=visit）永不 remap。
 */
export function surfaceHitlAgentId(
  originAgentId: string,
  options: {
    nestingParentId?: string;
    /** 保留入参以兼容调用方；委托归属不再看父是否 busy。 */
    busyAgentIds?: readonly string[];
    /** 缺省按 visit：旧盘上孤儿也不误挂到父会话 */
    origin?: HitlOrigin;
  },
): string {
  if (hitlOriginOf(options) !== "delegation") return originAgentId;
  const parentId = options.nestingParentId?.trim();
  if (!parentId) return originAgentId;
  return parentId;
}

/** 委托 HITL 卡片上的专家名与任务摘要（问题/命令正文仍用子会话原文）。 */
export function delegationHitlAttribution(task: {
  toAgentName: string;
  brief: string;
} | undefined): { askedByName?: string; taskLabel?: string } {
  if (!task) return {};
  const askedByName = task.toAgentName.trim();
  const brief = task.brief.trim().replace(/\s+/g, " ");
  const taskLabel = brief.length > 48 ? `${brief.slice(0, 47)}…` : brief;
  return {
    ...(askedByName ? { askedByName } : {}),
    ...(taskLabel ? { taskLabel } : {}),
  };
}
