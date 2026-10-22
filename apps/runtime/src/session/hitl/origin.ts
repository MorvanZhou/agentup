/**
 * HITL 会话角色：直聊 Visit 与委托子会话共用 agentId，必须靠 origin 区分，
 * 否则嵌套冒泡会把「用户与 Draw 直聊」的审批/问卷写进 Ace 的流与 dock。
 */
export type HitlOrigin = "visit" | "delegation";

export type HitlSessionRef = {
  origin?: HitlOrigin;
  /** 委托任务 id；仅 origin=delegation 时有意义 */
  taskId?: string;
  /** 委托方 agentId；仅 origin=delegation 时有意义 */
  parentAgentId?: string;
};

export type HitlExtensionContext = HitlSessionRef;

export function hitlOriginOf(request: { origin?: HitlOrigin }): HitlOrigin {
  return request.origin === "delegation" ? "delegation" : "visit";
}

/** 当前 Visit 直聊 turn 是否应展示该 HITL（不含委托子会话）。 */
export function isVisitOwnHitl(
  request: { agentId: string; origin?: HitlOrigin },
  visitAgentId: string,
): boolean {
  return request.agentId === visitAgentId && hitlOriginOf(request) === "visit";
}

/**
 * 父 turn 流是否应冒泡该 HITL。
 * 仅委托子会话、且仍登记在 parent 的 nested 集合下。
 */
export function shouldBubbleNestedHitl(
  request: { agentId: string; origin?: HitlOrigin; parentAgentId?: string },
  visit: { userId: string; agentId: string },
  isNestedUnder: (userId: string, parentAgentId: string, childAgentId: string) => boolean,
): boolean {
  if (hitlOriginOf(request) !== "delegation") return false;
  if (request.parentAgentId && request.parentAgentId !== visit.agentId) return false;
  return isNestedUnder(visit.userId, visit.agentId, request.agentId);
}
