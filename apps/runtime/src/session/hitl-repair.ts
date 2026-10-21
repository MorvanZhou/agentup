import fs from "node:fs";
import path from "node:path";

import { buildSessionContext, SessionManager } from "@earendil-works/pi-coding-agent";

import { PERSONAL_ASSISTANT_ID, ensurePersonalAssistant } from "../local/personal-assistant.js";
import type { ApprovalRequest } from "./approval.js";
import type { AskUserAnswer, AskUserRequest } from "./tools/ask-user.js";

/** 运行时重启后用户仍批准：工具未执行，提示模型按需重试（A：可闭合、不假执行）。 */
export const ORPHAN_APPROVED_RESULT =
  "User approved this tool call, but the runtime restarted before it ran. Retry the tool if it is still needed.";

export const ORPHAN_DENIED_RESULT = "用户拒绝了这次工具调用";

/**
 * 把孤儿 HITL 写成 toolResult，使会话可继续。
 * 若对应 toolCall 已有结果或不存在，返回 false（调用方应丢弃该 pending）。
 */
export function repairOrphanApproval(
  userDataRoot: string,
  request: ApprovalRequest,
  allowed: boolean,
): boolean {
  return appendDanglingToolResult(
    userDataRoot,
    request.userId,
    request.agentId,
    request.toolCallId,
    request.toolName,
    allowed ? ORPHAN_APPROVED_RESULT : ORPHAN_DENIED_RESULT,
  );
}

export function repairOrphanAskUser(
  userDataRoot: string,
  request: AskUserRequest,
  answer: AskUserAnswer,
): boolean {
  const text = formatOrphanAskUserResult(request, answer);
  return appendDanglingToolResult(
    userDataRoot,
    request.userId,
    request.agentId,
    request.toolCallId,
    "ask_user",
    text,
  );
}

/** 主会话里是否仍有该 toolCall 悬空（无 toolResult）。 */
export function hasDanglingToolCall(
  userDataRoot: string,
  userId: string,
  agentId: string,
  toolCallId: string,
): boolean {
  const manager = openRecentManager(userDataRoot, userId, agentId);
  if (!manager) return false;
  return danglingToolCallIds(manager).has(toolCallId);
}

function appendDanglingToolResult(
  userDataRoot: string,
  userId: string,
  agentId: string,
  toolCallId: string,
  toolName: string,
  text: string,
): boolean {
  const manager = openRecentManager(userDataRoot, userId, agentId);
  if (!manager) return false;
  if (!danglingToolCallIds(manager).has(toolCallId)) return false;
  manager.appendMessage({
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  } as never);
  return true;
}

function openRecentManager(
  userDataRoot: string,
  userId: string,
  agentId: string,
): SessionManager | undefined {
  const { cwd, sessionDir } = visitPaths(userDataRoot, userId, agentId);
  if (!fs.existsSync(sessionDir)) return undefined;
  try {
    return SessionManager.continueRecent(cwd, sessionDir);
  } catch {
    return undefined;
  }
}

function visitPaths(
  userDataRoot: string,
  userId: string,
  agentId: string,
): { cwd: string; sessionDir: string } {
  if (agentId === PERSONAL_ASSISTANT_ID) {
    const root = ensurePersonalAssistant(userDataRoot, userId);
    return { cwd: path.join(root, "cwd"), sessionDir: path.join(root, "sessions") };
  }
  const visitRoot = path.join(userDataRoot, "users", userId, "agents", agentId);
  return { cwd: path.join(visitRoot, "cwd"), sessionDir: path.join(visitRoot, "sessions") };
}

function danglingToolCallIds(manager: SessionManager): Set<string> {
  const pending = new Set<string>();
  for (const message of buildSessionContext(manager.getEntries()).messages) {
    if (!message || typeof message !== "object") continue;
    const record = message as {
      role?: unknown;
      content?: unknown;
      toolCallId?: unknown;
    };
    if (record.role === "assistant" && Array.isArray(record.content)) {
      for (const part of record.content) {
        if (!part || typeof part !== "object") continue;
        const item = part as { type?: unknown; id?: unknown };
        if (item.type === "toolCall" && typeof item.id === "string") pending.add(item.id);
      }
    }
    if (record.role === "toolResult" && typeof record.toolCallId === "string") {
      pending.delete(record.toolCallId);
    }
  }
  return pending;
}

function formatOrphanAskUserResult(request: AskUserRequest, answer: AskUserAnswer): string {
  if (answer.kind === "cancelled") {
    return "User dismissed the questions. Proceed with your best judgment, or ask again if the answers are required.";
  }
  const lines: string[] = [];
  for (let index = 0; index < request.questions.length; index += 1) {
    const item = answer.items[index] ?? { kind: "skipped" as const };
    const q = request.questions[index]!;
    if (item.kind === "skipped") {
      lines.push(`${index + 1}. ${q.question} → (skipped)`);
      continue;
    }
    if (item.kind === "freeform") {
      lines.push(`${index + 1}. ${q.question} → ${item.text}`);
      continue;
    }
    lines.push(`${index + 1}. ${q.question} → ${item.selections.join("; ")}`);
  }
  return `User answers:\n${lines.join("\n")}`;
}
