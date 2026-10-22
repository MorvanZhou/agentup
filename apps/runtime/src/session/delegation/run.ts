import fs from "node:fs";
import path from "node:path";

import {
  createAgentSession,
  createMcpExtension,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";

import type { ModelConfig } from "../../config/load.js";
import type { Visit } from "../../package/sync.js";
import { ApprovalBroker, createApprovalExtension } from "../hitl/approval/index.js";
import { createCheckpointExtension } from "../checkpoint/extension.js";
import { PiUIMessageProjector } from "../history/frames.js";
import { projectHistoryFromManager } from "../history/history.js";
import { projectVisitMcp } from "../workspace/mcp.js";
import { openModelRuntime } from "../model/runtime.js";
import { ensureCwdLayout, formatCwdLayoutPrompt } from "../workspace/cwd-layout.js";
import {
  readProjectRoots,
  resolveAllowedRoots,
} from "../workspace/project-roots.js";
import { buildSessionPlan } from "../plan.js";
import { projectVisitAgentsMd } from "../workspace/agents-md.js";
import {
  AskUserBroker,
  createAskUserExtension,
  createFsGuardExtension,
  createTodoExtension,
  createWebToolsExtension,
  formatToolsUsagePrompt,
} from "../tools/index.js";
import {
  createOutputLengthExtension,
  resolveEmptyAssistantError,
} from "../output-length.js";
import type { DelegationProgressHub } from "./progress.js";

export type DelegationRunOutcome = {
  text: string;
  error?: string;
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
    /** 父 turn / 工具 signal：用户停止主对话时一并中止子委托（无默认硬超时）。 */
    signal?: AbortSignal;
    progress?: DelegationProgressHub;
  },
): Promise<DelegationRunOutcome> {
  const plan = buildSessionPlan(visit, model);
  const sessionDir = delegationSessionDir(visit.root, options.taskId);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(plan.cwd, { recursive: true });
  ensureCwdLayout(plan.cwd);
  if (visit.kind !== "personal") projectVisitAgentsMd(visit.root);

  const hitl = {
    origin: "delegation" as const,
    taskId: options.taskId,
    parentAgentId: options.parentAgentId,
  };
  const mcpConfig = projectVisitMcp(plan.cwd, visit.userId);
  const mcpEnabled = mcpConfig.servers.length > 0;
  const settingsManager = SettingsManager.create(plan.cwd, plan.agentDir, { projectTrusted: true });
  const packageSkills = path.join(plan.cwd, ".pi", "skills");
  const resourceLoader = new DefaultResourceLoader({
    cwd: plan.cwd,
    agentDir: plan.agentDir,
    settingsManager,
    noSkills: true,
    additionalSkillPaths: fs.existsSync(packageSkills) ? [packageSkills] : [],
    extensionFactories: [
      createFsGuardExtension(plan.cwd, () => {
        const kind = visit.kind === "personal" ? "personal" : "agent";
        return resolveAllowedRoots(plan.cwd, readProjectRoots(visit.root, kind));
      }),
      createWebToolsExtension(),
      createAskUserExtension(askUser, visit.userId, visit.agentId, hitl),
      createTodoExtension(),
      createOutputLengthExtension(),
      createCheckpointExtension(visit.root),
      ...(mcpEnabled ? [createMcpExtension({ loadConfig: () => mcpConfig })] : []),
      createApprovalExtension(approvals, visit.userId, visit.agentId, {
        hitl,
        projectMount: {
          cwd: plan.cwd,
          visitRoot: visit.root,
          kind: visit.kind === "personal" ? "personal" : "agent",
          userDataRoot:
            visit.kind === "personal"
              ? path.resolve(visit.root, "..", "..")
              : path.resolve(visit.root, "..", "..", ".."),
        },
      }),
    ],
    disabledBuiltinExtensions: mcpEnabled ? [] : ["mcp"],
    skillsOverride: (loaded) => ({
      skills: loaded.skills.filter((skill) => {
        const file = path.resolve(skill.filePath);
        const root = path.resolve(packageSkills);
        return file === root || file.startsWith(`${root}${path.sep}`);
      }),
      diagnostics: loaded.diagnostics,
    }),
    appendSystemPromptOverride: (base) => [
      ...base,
      formatCwdLayoutPrompt(),
      formatToolsUsagePrompt(),
    ],
  });
  await resourceLoader.reload();
  const { runtime, model: registered } = await openModelRuntime(plan);
  const created = SessionManager.create(plan.cwd, sessionDir);
  const sessionFile = created.getSessionFile();
  if (!sessionFile) throw new Error("无法创建委托会话");
  fs.writeFileSync(sessionFile, "");
  const sessionManager = SessionManager.open(sessionFile, sessionDir, plan.cwd);

  const sessionOptions: CreateAgentSessionOptions = {
    cwd: plan.cwd,
    agentDir: plan.agentDir,
    modelRuntime: runtime,
    settingsManager,
    resourceLoader,
    sessionManager,
    model: registered,
    tools: plan.tools,
    thinkingLevel: "off",
    noTools: plan.tools.length > 0 ? undefined : mcpEnabled ? "builtin" : "all",
  };
  const { session } = await createAgentSession(sessionOptions);

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

  try {
    const promptText = formatDelegationPrompt(brief);
    // length 截断由 createOutputLengthExtension 在 agent_before_settle 内自动续写。
    await session.prompt(promptText);
    const text = texts.join("").trim() || collectBranchText(sessionManager);
    if (signal?.aborted) {
      const message = "用户已取消";
      if (progress) progress.write(options.taskId, projector.finish(message));
      return { text, error: message };
    }
    if (!text) {
      const message = resolveEmptyAssistantError(sessionManager);
      if (progress) progress.write(options.taskId, projector.finish(message));
      return { text: "", error: message };
    }
    if (progress) progress.write(options.taskId, projector.finish());
    return { text };
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
    return { text: partial, error: message };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    unsubscribe();
    progress?.finish(options.taskId);
    session.dispose();
  }
}

function formatDelegationPrompt(brief: string): string {
  return (
    "你正在处理来自用户私人助理的委托子任务。请只完成下列任务，完成后给出清晰、可引用的结果摘要。" +
    "不要向用户闲聊；若缺少关键信息，用 ask_user 提问。\n\n" +
    `## 任务\n${brief.trim()}`
  );
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
