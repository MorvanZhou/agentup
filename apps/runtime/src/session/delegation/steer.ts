import type { DelegationStatus } from "./types.js";

/** 插入说明的最大字符数。过长交给模型缩短后再试。 */
export const STEER_NOTE_MAX = 4000;

export type DelegationSteerBlock = "finished" | "not_started" | "waiting_user";

/**
 * 能否把新要求插进仍在跑的子任务。
 * 终态、还没开跑、或正等用户审批/提问时不插。
 */
export function delegationSteerBlock(input: {
  status: DelegationStatus;
  live: boolean;
  waitingOnUser: boolean;
}): DelegationSteerBlock | undefined {
  if (input.status === "completed" || input.status === "failed" || input.status === "cancelled") {
    return "finished";
  }
  if (input.status !== "running" || !input.live) return "not_started";
  if (input.waitingOnUser) return "waiting_user";
  return undefined;
}

/** 交给专员的插入说明：保留已做的工作，当前步骤结束后再按新要求继续。 */
export function formatDelegationSteerNote(note: string): string {
  return [
    "The coordinator added a requirement while you are still on this task.",
    "Apply it after the current step. Keep work already done; do not restart from scratch.",
    "",
    "## Update",
    note.trim(),
  ].join("\n");
}
