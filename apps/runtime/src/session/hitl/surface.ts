import { hitlOriginOf, type HitlOrigin } from "./origin.js";

/**
 * 嵌套委托 HITL 的展示归属：
 * 仅 `origin=delegation` 的子会话 HITL，在父 turn 仍 busy（同步 wait）时挂到父会话，
 * 与 turn 流 `shouldBubbleNestedHitl` 一致，避免子会话也亮 dock。
 * 用户与同一 agent 的直聊 HITL（origin=visit）永不 remap，防止串场到委托方。
 * 异步委托（父已空闲）则仍挂在真实发起方。
 */
export function surfaceHitlAgentId(
  originAgentId: string,
  options: {
    nestingParentId?: string;
    busyAgentIds: readonly string[];
    /** 缺省按 visit：旧盘上孤儿也不误挂到父会话 */
    origin?: HitlOrigin;
  },
): string {
  if (hitlOriginOf(options) !== "delegation") return originAgentId;
  const parentId = options.nestingParentId?.trim();
  if (!parentId) return originAgentId;
  if (!options.busyAgentIds.includes(parentId)) return originAgentId;
  return parentId;
}
