import { delegationHitlAttribution, surfaceHitlAgentId } from "../../session/hitl/surface.js";
import type { LocalAppDeps } from "../http.js";

/** `/attention` 与 `/desktop-pulse` 共用的侧栏 / Dock 快照。 */
export function buildAttentionPayload(
  deps: Pick<LocalAppDeps, "approvals" | "askUser" | "shellHang" | "chats" | "delegation">,
  userId: string,
): Record<string, unknown> {
  const { approvals, askUser, shellHang, chats, delegation } = deps;
  approvals.restoreUser(userId);
  askUser.restoreUser(userId);
  const busyTurns = chats.busyTurns(userId);
  const busyAgentIds = busyTurns.map((item) => item.agentId);
  const nestingParent = (item: {
    agentId: string;
    origin?: "visit" | "delegation";
    parentAgentId?: string;
  }) =>
    item.parentAgentId?.trim() ||
    (item.origin === "delegation" ? delegation.findNestingParent(userId, item.agentId) : undefined);
  const surfaceAgent = (item: {
    agentId: string;
    origin?: "visit" | "delegation";
    parentAgentId?: string;
  }) =>
    surfaceHitlAgentId(item.agentId, {
      nestingParentId: nestingParent(item),
      busyAgentIds,
      origin: item.origin,
    });
  const hitlAttribution = (item: { origin?: "visit" | "delegation"; taskId?: string }) => {
    if (item.origin !== "delegation" || !item.taskId) return {};
    const task =
      "getTask" in delegation && typeof delegation.getTask === "function"
        ? delegation.getTask(item.taskId)
        : undefined;
    return delegationHitlAttribution(task);
  };
  return {
    busy_agent_ids: busyAgentIds,
    busy_turns: busyTurns.map((item) => ({
      agent_id: item.agentId,
      phase: item.phase,
      sources: item.sources.map((source) => ({
        name: source.name,
        status: source.status,
        agent_id: source.agentId,
        kind: source.kind,
      })),
    })),
    // 委托 HITL 的 agent_id 是跟进方；asked_by_name / task_label 标明是谁的哪件任务。
    approvals: approvals.listPending(userId).map((item) => {
      const label = hitlAttribution(item);
      return {
        id: item.id,
        agent_id: surfaceAgent(item),
        origin_agent_id: item.agentId,
        parent_agent_id: nestingParent(item) ?? null,
        tool_call_id: item.toolCallId,
        tool_name: item.toolName,
        args: item.args,
        ...(item.groupId ? { group_id: item.groupId } : {}),
        ...(label.askedByName ? { asked_by_name: label.askedByName } : {}),
        ...(label.taskLabel ? { task_label: label.taskLabel } : {}),
        ...(item.taskId ? { task_id: item.taskId } : {}),
      };
    }),
    ask_users: askUser.listPending(userId).map((item) => {
      const label = hitlAttribution(item);
      return {
        id: item.id,
        agent_id: surfaceAgent(item),
        origin_agent_id: item.agentId,
        parent_agent_id: nestingParent(item) ?? null,
        tool_call_id: item.toolCallId,
        questions: item.questions,
        ...(item.groupId ? { group_id: item.groupId } : {}),
        ...(label.askedByName ? { asked_by_name: label.askedByName } : {}),
        ...(label.taskLabel ? { task_label: label.taskLabel } : {}),
        ...(item.taskId ? { task_id: item.taskId } : {}),
      };
    }),
    shell_hangs: shellHang.listPending(userId).map((item) => {
      const label = hitlAttribution(item);
      return {
        id: item.id,
        agent_id: surfaceAgent(item),
        origin_agent_id: item.agentId,
        parent_agent_id: nestingParent(item) ?? null,
        tool_call_id: item.toolCallId,
        tool_name: item.toolName,
        command: item.command,
        elapsed_ms: item.elapsedMs,
        ...(item.groupId ? { group_id: item.groupId } : {}),
        ...(label.askedByName ? { asked_by_name: label.askedByName } : {}),
        ...(label.taskLabel ? { task_label: label.taskLabel } : {}),
        ...(item.taskId ? { task_id: item.taskId } : {}),
      };
    }),
  };
}
