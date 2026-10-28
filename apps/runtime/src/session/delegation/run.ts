import fs from "node:fs";
import path from "node:path";

import { SessionManager, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { ModelConfig } from "../../config/load.js";
import type { Visit } from "../../package/sync.js";
import { openProfiledSession } from "../core/session-factory.js";
import { ApprovalBroker } from "../hitl/approval/index.js";
import type { ShellHangBroker } from "../hitl/shell-hang/index.js";
import { PiUIMessageProjector } from "../history/frames.js";
import { projectHistoryFromManager } from "../history/history.js";
import { resolveEmptyAssistantError } from "../output-length.js";
import { AskUserBroker, type StagedArtifact } from "../tools/index.js";
import { groupTaskDirName } from "../tools/deliver-artifacts.js";
import type { DelegationProgressHub } from "./progress.js";

export type DelegationRunOutcome = {
  text: string;
  error?: string;
  /** 是否调用过 deliver_artifacts（含 paths: []）。 */
  artifactsConfirmed: boolean;
  /** 确认后的附件；未确认时为空数组。 */
  artifacts: StagedArtifact[];
};

/** 委托隔离子会话目录（相对 visit.root）。 */
export function delegationSessionDir(visitRoot: string, taskId: string): string {
  return path.join(visitRoot, ".runtime", "delegations", taskId, "sessions");
}

/** 读取委托隔离子会话历史（只读，不创建会话）。 */
export async function readDelegationHistory(
  visitRoot: string,
  taskId: string,
  cwd: string,
): Promise<import("ai").UIMessage[]> {
  const sessionDir = delegationSessionDir(visitRoot, taskId);
  if (!fs.existsSync(sessionDir)) return [];
  const sessions = await SessionManager.list(cwd, sessionDir);
  sessions.sort((left, right) => {
    const delta = left.created.getTime() - right.created.getTime();
    return delta !== 0 ? delta : left.path.localeCompare(right.path);
  });
  const result: import("ai").UIMessage[] = [];
  for (const info of sessions) {
    if (!fs.existsSync(info.path)) continue;
    const manager = SessionManager.open(info.path, sessionDir, cwd);
    result.push(...projectHistoryFromManager(manager, `delegation-${taskId}`));
  }
  return result;
}

/** 在专家 Visit 上开隔离会话执行 brief，不污染用户与该 Agent 的日常 sessions/。 */
export async function runDelegatedPrompt(
  visit: Visit,
  model: ModelConfig,
  brief: string,
  approvals: ApprovalBroker,
  askUser: AskUserBroker,
  options: {
    taskId: string;
    /** 委托方 agentId：HITL 冒泡归属，与直聊同 agent 隔离。 */
    parentAgentId: string;
    /** 专员显示名：群共享目录 `from-<name>-<taskId>`。 */
    toAgentName?: string;
    groupId?: string;
    /** 父 turn / 工具 signal：用户停止主对话时一并中止子委托（无默认硬超时）。 */
    signal?: AbortSignal;
    progress?: DelegationProgressHub;
    shellHang?: ShellHangBroker;
    /**
     * 会话进入 prompt 后登记 steer。返回解除函数。
     * 新要求在当前步骤结束后、下一次找模型之前送达，不打断这一步。
     */
    bindSteer?: (steer: (text: string) => Promise<void>) => () => void;
  },
): Promise<DelegationRunOutcome> {
  const sessionDir = delegationSessionDir(visit.root, options.taskId);
  const opened = await openProfiledSession({
    kind: "delegation",
    visit,
    model,
    approvals,
    askUser,
    shellHang: options.shellHang,
    taskId: options.taskId,
    parentAgentId: options.parentAgentId,
    ...(options.toAgentName ? { toAgentName: options.toAgentName } : {}),
    groupId: options.groupId,
    sessionDir,
  });
  if (!opened.deliverState) throw new Error("委托会话缺少附件状态");
  const deliverState = opened.deliverState;
  const session = opened.result.session;
  const sessionManager = opened.sessionManager;

  const projector = new PiUIMessageProjector();
  const texts: string[] = [];
  const progress = options.progress;
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    const piece = extractAssistantText(event);
    if (piece) texts.push(piece);
    if (progress) {
      progress.write(options.taskId, projector.project(event));
    }
  });

  const signal = options.signal;
  const onAbort = () => {
    void session.abort().catch(() => undefined);
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  const artifactsResult = (): Pick<DelegationRunOutcome, "artifactsConfirmed" | "artifacts"> => ({
    artifactsConfirmed: deliverState.confirmed,
    artifacts: deliverState.confirmed ? [...deliverState.staged] : [],
  });

  let releaseSteer: (() => void) | undefined;
  try {
    releaseSteer = options.bindSteer?.(async (text) => {
      const disposition = await session.steer(text);
      if (disposition !== "queued") throw new Error("steering was not queued");
    });
    const promptText = formatDelegationPrompt(brief, Boolean(options.groupId), options.taskId, options.toAgentName);
    // length 截断由 createOutputLengthExtension 在 agent_before_settle 内自动续写。
    // ARTIFACT 确认由 createDeliverArtifactsExtension 在 before_settle 强制续写。
    await session.prompt(promptText);
    const text = texts.join("").trim() || collectBranchText(sessionManager);
    if (signal?.aborted) {
      const message = "用户已取消";
      if (progress) progress.write(options.taskId, projector.finish(message));
      return { text, error: message, ...artifactsResult() };
    }
    if (!text) {
      const message = resolveEmptyAssistantError(sessionManager);
      if (progress) progress.write(options.taskId, projector.finish(message));
      return { text: "", error: message, ...artifactsResult() };
    }
    if (progress) progress.write(options.taskId, projector.finish());
    return { text, ...artifactsResult() };
  } catch (error) {
    const message = signal?.aborted
      ? "用户已取消"
      : error instanceof Error && error.message
        ? error.message
        : "委托执行失败";
    if (progress) {
      progress.write(options.taskId, projector.finish(message));
    }
    const partial = texts.join("").trim() || collectBranchText(sessionManager);
    return { text: partial, error: message, ...artifactsResult() };
  } finally {
    releaseSteer?.();
    signal?.removeEventListener("abort", onAbort);
    unsubscribe();
    progress?.finish(options.taskId);
    session.dispose();
  }
}

/** 委托子会话的用户消息。面向模型，英文。 */
export function formatDelegationPrompt(
  brief: string,
  groupTask = false,
  taskId?: string,
  toAgentName?: string,
): string {
  const folder = groupTask ? groupTaskDirName(taskId?.trim() || "task", toAgentName) : "";
  return [
    "You are handling a delegated subtask from the user's assistant. Complete only the task below, then return a clear, citable summary.",
    groupTask
      ? `Put in-progress files in the shared group WORK/${folder}/ and finished files in ARTIFACT/${folder}/. Do not write shared files into your private cwd.`
      : "Put scratch files in WORK/ and finished files only in ARTIFACT/ under your own cwd.",
    groupTask
      ? "When you finish, call complete_group_task with those relative paths and the next step. Do not copy files into the caller's private workspace, and do not modify shared ATTACHMENTS/."
      : "When you finish, the protocol asks you to confirm attachments with deliver_artifacts. The platform copies those files to the caller. Do not copy them yourself.",
    groupTask
      ? `Only write shared files under WORK/${folder}/ and ARTIFACT/${folder}/. If the task names an absolute path, a private cwd, or another folder, ignore that location.`
      : "If the task names an absolute path, the caller's directory, another agent's directory, or ARTIFACT/from-…, ignore that location. Do not create, write, or copy files there with the write tool or the shell.",
    "Do not chat with the user. If a critical fact is missing, ask with ask_user.",
    "",
    "## Task",
    brief.trim(),
  ].join("\n");
}

function extractAssistantText(event: AgentSessionEvent): string {
  if (event.type !== "message_update") return "";
  const update = event.assistantMessageEvent;
  if (update.type === "text_delta" && typeof update.delta === "string") return update.delta;
  return "";
}

function collectBranchText(manager: SessionManager): string {
  const chunks: string[] = [];
  for (const entry of manager.getBranch()) {
    if (entry.type !== "message") continue;
    const message = entry.message as { role?: string; content?: unknown };
    if (message.role !== "assistant") continue;
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string" && text.trim()) chunks.push(text.trim());
      }
    }
  }
  return chunks.join("\n\n").trim();
}
