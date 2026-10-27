import type { DelegationTask } from "./types.js";

/** 每轮注入的进行中委托条数上限。 */
export const MAX_ACTIVE_DELEGATION_CONTEXT = 8;

/** brief 摘要最大字符数（超出截断）。 */
export const ACTIVE_BRIEF_MAX_CHARS = 120;

const ACTIVE_STATUSES = new Set<DelegationTask["status"]>([
  "running",
  "pending_auth",
]);

/**
 * 挑出仍在进行中的委托（running / pending_auth），供每轮 nextTurn 注入。
 */
export function selectActiveDelegations(
  tasks: readonly DelegationTask[],
): DelegationTask[] {
  return tasks.filter((task) => ACTIVE_STATUSES.has(task.status));
}

/**
 * 拼进每轮模型上下文的进行中委托块。
 * 无进行中任务 → 空串（不污染本轮）。
 */
export function formatActiveDelegationsContext(
  tasks: readonly DelegationTask[],
): string {
  const active = selectActiveDelegations(tasks);
  if (active.length === 0) return "";

  const listed = active.slice(0, MAX_ACTIVE_DELEGATION_CONTEXT);
  const truncated = active.length > listed.length;
  const lines = listed.map(
    (task) =>
      `- task_id: ${task.id} | status: ${task.status} | ` +
      `${task.toAgentName} (${task.toAgentId}) | brief: ${truncateBrief(task.brief)}`,
  );

  return (
    [
      "# Active delegations",
      "",
      "These specialist tasks from you are still in progress (running or awaiting approval).",
      "Before delegate_to_agent: if an overlapping brief or the same specialist is listed, call check_delegation first.",
      "If the user is refining a running task, call steer_delegation(task_id, note) or resolve_delegation_update(action=steer). The specialist keeps the current run and applies the note after the current step.",
      "Before you finish this user turn, call resolve_delegation_update once per listed task. A reply that only says you forwarded or noted the change does not reach the specialist. check_delegation does not count.",
      "Do not re-delegate the same specialist for a duplicate/overlapping brief — steer_delegation, wait for completion, check_delegation, or cancel_delegation.",
      "pending_auth has not started: steer_delegation will not insert. Wait, or cancel_delegation.",
      "If one ends cancelled/failed: re-delegate or ask the user who should continue — do not take over that specialist's work yourself.",

      "",
      ...lines,
    ].join("\n") +
    (truncated
      ? `\n\n(More active tasks — call check_delegation with no args for the full recent list.)`
      : "")
  );
}

function truncateBrief(brief: string): string {
  const trimmed = brief.trim().replace(/\s+/g, " ");
  if (trimmed.length <= ACTIVE_BRIEF_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, ACTIVE_BRIEF_MAX_CHARS - 1)}…`;
}
