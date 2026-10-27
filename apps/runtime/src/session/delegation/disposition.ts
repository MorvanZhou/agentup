import type { DelegationTask } from "./types.js";

/** 同一用户回合里，未处置进行中委托时最多强制续一轮的次数。 */
export const MAX_DELEGATION_DISPOSITION_FORCES = 2;

export const RESOLVE_DELEGATION_UPDATE_TOOL = "resolve_delegation_update";

export const AGENTUP_DELEGATION_DISPOSITION_TYPE = "agentup.delegation_disposition";

export type DelegationDispositionAction = "steer" | "keep" | "cancel" | "new_task";

const ACTIONS = new Set<DelegationDispositionAction>(["steer", "keep", "cancel", "new_task"]);

/**
 * 本回合开始时仍在进行的委托。回合中新派的任务不计入，避免刚派完又被要求处置。
 */
export function selectOpenDelegationTaskIds(
  tasks: readonly Pick<DelegationTask, "id" | "fromAgentId" | "status">[],
  fromAgentId: string,
): string[] {
  return tasks
    .filter(
      (task) =>
        task.fromAgentId === fromAgentId &&
        (task.status === "running" || task.status === "pending_auth"),
    )
    .map((task) => task.id);
}

export function unresolvedDelegationTaskIds(
  openTaskIds: readonly string[],
  resolvedTaskIds: ReadonlySet<string>,
): string[] {
  return openTaskIds.filter((id) => !resolvedTaskIds.has(id));
}

/**
 * 用户回合、仍有未处置的进行中委托、且还能续写时，不允许助手只靠文字结束。
 * 超过次数后放行，避免死循环。
 */
export function shouldForceDelegationDisposition(input: {
  outcome: string;
  canContinue: boolean;
  unresolvedTaskIds: readonly string[];
  forces: number;
  maxForces?: number;
}): boolean {
  if (input.outcome === "aborted" || input.outcome === "error") return false;
  if (!input.canContinue) return false;
  if (input.unresolvedTaskIds.length === 0) return false;
  const max = input.maxForces ?? MAX_DELEGATION_DISPOSITION_FORCES;
  return input.forces < max;
}

export function formatDelegationDispositionPrompt(taskIds: readonly string[]): string {
  return [
    "You have not disposed of every in-progress delegation for this user message.",
    "Saying you forwarded, noted, or will check later does not reach the specialist.",
    `Call ${RESOLVE_DELEGATION_UPDATE_TOOL} once per task_id before you finish:`,
    "- steer: the user is changing that same running task (note required). This calls steer_delegation.",
    "- keep: this message does not change that task (reason required).",
    "- cancel: the user wants that task stopped.",
    "- new_task: this is different work, not an update of that task (reason required), then delegate_to_agent if you still need a new specialist.",
    `Unresolved task_id: ${taskIds.join(", ")}`,
  ].join("\n");
}

export function parseDelegationDisposition(input: {
  taskId: string;
  action: string;
  note: string;
  reason: string;
  openTaskIds: readonly string[];
}):
  | { ok: true; taskId: string; action: DelegationDispositionAction; note: string; reason: string }
  | { ok: false; error: string } {
  const taskId = input.taskId.trim();
  if (!taskId) return { ok: false, error: "task_id required" };
  if (!input.openTaskIds.includes(taskId)) {
    return { ok: false, error: `task_id is not an in-progress delegation this turn: ${taskId}` };
  }
  if (!ACTIONS.has(input.action as DelegationDispositionAction)) {
    return { ok: false, error: "action must be steer, keep, cancel, or new_task" };
  }
  const action = input.action as DelegationDispositionAction;
  const note = input.note.trim();
  const reason = input.reason.trim();
  if (action === "steer" && !note) return { ok: false, error: "note required for steer" };
  if ((action === "keep" || action === "new_task") && !reason) {
    return { ok: false, error: `reason required for ${action}` };
  }
  return { ok: true, taskId, action, note, reason };
}
