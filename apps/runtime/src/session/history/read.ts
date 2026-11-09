import fs from "node:fs";
import path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { UIMessage } from "ai";

import { ensurePersonalAssistant } from "../../local/assistant/personal-assistant.js";
import { TRANSCRIPT_PAGE_SIZE } from "../transcript-page.js";
import { contextResetMessage } from "./constants.js";
import { visitSession } from "./paths.js";
import { projectSession } from "./project.js";

/**
 * 读取本机 `sessions/` 里全部 Pi 会话，按创建时间拼成一条时间线。
 * 会话边界插入「新对话」标记；只读文件，不经 backend，也不创建会话。
 */
export async function readHistory(userDataRoot: string, userId: string, agentId: string): Promise<UIMessage[]> {
  const { cwd, sessionDir } = visitSession(userDataRoot, userId, agentId);
  return readHistoryAt(cwd, sessionDir);
}

export async function readPersonalHistory(userDataRoot: string, userId: string): Promise<UIMessage[]> {
  const root = ensurePersonalAssistant(userDataRoot, userId);
  return readHistoryAt(path.join(root, "cwd"), path.join(root, "sessions"));
}

export type HistoryPage = { messages: UIMessage[]; hasMore: boolean };

/**
 * 打开一对一时只投影最新一段 Pi 会话（当前上下文，编辑重发的序号按它算）。
 * `beforeId` 再往更早的会话翻，`limit` 只限制那些旧会话。
 */
export async function readHistoryPage(
  userDataRoot: string,
  userId: string,
  agentId: string,
  options: { limit?: number; beforeId?: string } = {},
): Promise<HistoryPage> {
  const { cwd, sessionDir } = visitSession(userDataRoot, userId, agentId);
  return readHistoryPageAt(cwd, sessionDir, options);
}

export async function readPersonalHistoryPage(
  userDataRoot: string,
  userId: string,
  options: { limit?: number; beforeId?: string } = {},
): Promise<HistoryPage> {
  const root = ensurePersonalAssistant(userDataRoot, userId);
  return readHistoryPageAt(path.join(root, "cwd"), path.join(root, "sessions"), options);
}

/**
 * 读某会话目录里时间线上最后一条 assistant（含 summary / artifacts metadata）。
 * 群执掌者回合结束后用来把 byproducts 挂到 GroupLine。
 */
export async function readLastAssistantAt(
  cwd: string,
  sessionDir: string,
): Promise<UIMessage | null> {
  const messages = await readHistoryAt(cwd, sessionDir);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") return message;
  }
  return null;
}

async function readHistoryAt(cwd: string, sessionDir: string): Promise<UIMessage[]> {
  const sessions = await listSessionFiles(cwd, sessionDir);
  const result: UIMessage[] = [];
  let pendingReset = false;

  for (const info of sessions) {
    const messages = projectSession(cwd, sessionDir, info);
    if (messages.length === 0) {
      if (result.length > 0) pendingReset = true;
      continue;
    }
    if (result.length > 0) {
      result.push(contextResetMessage(info.id));
      pendingReset = false;
    }
    result.push(...messages);
  }

  if (pendingReset) {
    result.push(contextResetMessage("pending"));
  }

  return result;
}

async function readHistoryPageAt(
  cwd: string,
  sessionDir: string,
  options: { limit?: number; beforeId?: string },
): Promise<HistoryPage> {
  const sessions = await listSessionFiles(cwd, sessionDir);
  if (sessions.length === 0) return { messages: [], hasMore: false };
  const limit = options.limit && options.limit > 0 ? options.limit : TRANSCRIPT_PAGE_SIZE;

  if (!options.beforeId) {
    const newest = sessions[sessions.length - 1]!;
    const messages = projectSession(cwd, sessionDir, newest);
    if (messages.length === 0 && sessions.length > 1) {
      return { messages: [contextResetMessage("pending")], hasMore: true };
    }
    return { messages, hasMore: sessions.length > 1 };
  }

  if (options.beforeId === contextResetMessage("pending").id) {
    return collectHistoryBefore(cwd, sessionDir, sessions.slice(0, -1), null, limit);
  }
  return collectHistoryBefore(cwd, sessionDir, sessions, options.beforeId, limit);
}

/** 从新往旧收集 `beforeId` 之前的一页。凑够 limit+1 后不再打开更早的会话文件。 */
async function collectHistoryBefore(
  cwd: string,
  sessionDir: string,
  sessions: readonly SessionInfo[],
  beforeId: string | null,
  limit: number,
): Promise<HistoryPage> {
  const wanted = limit + 1;
  const newestFirst: UIMessage[] = [];
  let seen = beforeId == null;

  const consider = (message: UIMessage): boolean => {
    if (!seen) {
      if (message.id === beforeId) seen = true;
      return false;
    }
    newestFirst.push(message);
    return newestFirst.length >= wanted;
  };

  for (let index = sessions.length - 1; index >= 0 && newestFirst.length < wanted; index -= 1) {
    const info = sessions[index]!;
    const messages = projectSession(cwd, sessionDir, info);
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      if (consider(messages[messageIndex]!)) break;
    }
    if (newestFirst.length >= wanted) break;
    if (index > 0 && consider(contextResetMessage(info.id))) break;
  }

  if (beforeId && !seen) return { messages: [], hasMore: false };
  return {
    messages: newestFirst.slice(0, limit).reverse(),
    hasMore: newestFirst.length > limit,
  };
}

type SessionInfo = { id: string; path: string; created: Date };

async function listSessionFiles(cwd: string, sessionDir: string): Promise<SessionInfo[]> {
  if (!fs.existsSync(sessionDir)) return [];
  const sessions = await SessionManager.list(cwd, sessionDir);
  sessions.sort((left, right) => {
    const delta = left.created.getTime() - right.created.getTime();
    return delta !== 0 ? delta : left.path.localeCompare(right.path);
  });
  return sessions;
}
