import fs from "node:fs";
import path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import { ensurePersonalAssistant } from "../../local/assistant/personal-assistant.js";
import { clearCheckpoints } from "../checkpoint/checkpoint.js";
import { stampNewSessionModel } from "../model/session-model.js";
import { visitSession } from "./paths.js";

/** 新开一个空的 Pi 会话，让之后的消息不再带上之前的上下文。旧会话文件保留。 */
export function clearContext(userDataRoot: string, userId: string, agentId: string): void {
  const { cwd, sessionDir } = visitSession(userDataRoot, userId, agentId);
  clearContextAt(userDataRoot, cwd, sessionDir);
}

export function clearPersonalContext(userDataRoot: string, userId: string): void {
  const root = ensurePersonalAssistant(userDataRoot, userId);
  clearContextAt(userDataRoot, path.join(root, "cwd"), path.join(root, "sessions"));
}

export function clearContextAt(userDataRoot: string, cwd: string, sessionDir: string): void {
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  const created = SessionManager.create(cwd, sessionDir);
  const file = created.getSessionFile();
  if (!file) throw new Error("没有生成新会话");
  fs.writeFileSync(file, "");
  SessionManager.open(file, sessionDir, cwd);
  // 新对话继承上一 session 模型（无则 enabled 第一个）
  stampNewSessionModel(userDataRoot, cwd, sessionDir);
}

/** 永久删除该 Agent 本机全部会话文件；不动 cwd 工作产物。 */
export function clearHistory(userDataRoot: string, userId: string, agentId: string): void {
  const { sessionDir, visitRoot } = visitSession(userDataRoot, userId, agentId);
  clearHistoryAt(sessionDir);
  clearCheckpoints(visitRoot);
}

export function clearPersonalHistory(userDataRoot: string, userId: string): void {
  const root = ensurePersonalAssistant(userDataRoot, userId);
  clearHistoryAt(path.join(root, "sessions"));
  clearCheckpoints(root);
}

function clearHistoryAt(sessionDir: string): void {
  if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
  fs.mkdirSync(sessionDir, { recursive: true });
}
