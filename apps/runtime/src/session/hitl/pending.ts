import fs from "node:fs";
import path from "node:path";

import type { ApprovalRequest } from "./approval/index.js";
import type { AskUserRequest } from "../tools/ask-user.js";

/** 本机 HITL 快照：进程存活时写盘；重启后仅保留仍可闭合的孤儿请求（见 hitl/repair）。 */
export type StoredHitlPending = {
  approvals: ApprovalRequest[];
  askUsers: AskUserRequest[];
};

export function emptyHitlPending(): StoredHitlPending {
  return { approvals: [], askUsers: [] };
}

export function hitlPendingPath(userDataRoot: string, userId: string): string {
  return path.join(userDataRoot, "users", userId, ".runtime", "hitl-pending.json");
}

export function readHitlPending(userDataRoot: string, userId: string): StoredHitlPending {
  const file = hitlPendingPath(userDataRoot, userId);
  if (!fs.existsSync(file)) return emptyHitlPending();
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return validateHitlPending(raw);
  } catch {
    return emptyHitlPending();
  }
}

export function writeHitlPending(
  userDataRoot: string,
  userId: string,
  value: StoredHitlPending,
): void {
  const state = validateHitlPending(value);
  const file = hitlPendingPath(userDataRoot, userId);
  const temporary = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (state.approvals.length === 0 && state.askUsers.length === 0) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    return;
  }
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/** 只改 approvals，保留盘上 askUsers（两 Broker 共用一文件）。 */
export function writeHitlApprovals(
  userDataRoot: string,
  userId: string,
  approvals: ApprovalRequest[],
): void {
  const current = readHitlPending(userDataRoot, userId);
  writeHitlPending(userDataRoot, userId, { ...current, approvals });
}

/** 只改 askUsers，保留盘上 approvals。 */
export function writeHitlAskUsers(
  userDataRoot: string,
  userId: string,
  askUsers: AskUserRequest[],
): void {
  const current = readHitlPending(userDataRoot, userId);
  writeHitlPending(userDataRoot, userId, { ...current, askUsers });
}

function validateHitlPending(value: unknown): StoredHitlPending {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyHitlPending();
  const record = value as Record<string, unknown>;
  const approvals = Array.isArray(record.approvals)
    ? record.approvals.filter(isApprovalRequest)
    : [];
  const askUsers = Array.isArray(record.askUsers)
    ? record.askUsers.filter(isAskUserRequest)
    : Array.isArray(record.ask_users)
      ? record.ask_users.filter(isAskUserRequest)
      : [];
  return { approvals, askUsers };
}

function isApprovalRequest(value: unknown): value is ApprovalRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.userId !== "string" ||
    typeof item.agentId !== "string" ||
    typeof item.toolCallId !== "string" ||
    typeof item.toolName !== "string" ||
    item.args === null ||
    typeof item.args !== "object"
  ) {
    return false;
  }
  return isOptionalHitlRef(item);
}

function isAskUserRequest(value: unknown): value is AskUserRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.userId !== "string" ||
    typeof item.agentId !== "string" ||
    typeof item.toolCallId !== "string" ||
    !Array.isArray(item.questions)
  ) {
    return false;
  }
  return isOptionalHitlRef(item);
}

/** origin / taskId / parentAgentId 均可缺省（旧盘）；有则须类型正确。 */
function isOptionalHitlRef(item: Record<string, unknown>): boolean {
  if (
    item.origin !== undefined &&
    item.origin !== "visit" &&
    item.origin !== "delegation"
  ) {
    return false;
  }
  if (item.taskId !== undefined && typeof item.taskId !== "string") return false;
  if (item.parentAgentId !== undefined && typeof item.parentAgentId !== "string") {
    return false;
  }
  return true;
}
