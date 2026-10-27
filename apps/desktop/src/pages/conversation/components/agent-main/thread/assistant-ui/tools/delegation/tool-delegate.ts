/** 摘要行过长时截断。 */
export function clipToolDetail(text: string, max = 48): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function argTrimmedString(args: unknown, key: string): string {
  if (!args || typeof args !== "object") return "";
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

export function fanoutTaskCount(args: unknown): number {
  if (!args || typeof args !== "object") return 0;
  const tasks = (args as { tasks?: unknown }).tasks;
  return Array.isArray(tasks) ? tasks.length : 0;
}

export function checkTaskIdCount(args: unknown): number {
  if (!args || typeof args !== "object") return 0;
  const ids = (args as { task_ids?: unknown }).task_ids;
  return Array.isArray(ids) ? ids.length : 0;
}

/** check_delegation 摘要：单 id / 多 id / 最近。 */
export function checkDelegationSummary(args: unknown): {
  taskId: string;
  taskIdCount: number;
} {
  return {
    taskId: argTrimmedString(args, "task_id"),
    taskIdCount: checkTaskIdCount(args),
  };
}

export function steerNoteFromArgs(args: unknown): string {
  return argTrimmedString(args, "note");
}

export function resolveActionFromArgs(args: unknown): string {
  return argTrimmedString(args, "action").toLowerCase();
}
