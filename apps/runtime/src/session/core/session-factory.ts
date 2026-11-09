import fs from "node:fs";
import path from "node:path";

import {
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
  type ExtensionFactory,
  type Skill,
} from "@earendil-works/pi-coding-agent";

import type { ModelConfig } from "../../config/load.js";
import { listEnabledUserSkillPaths } from "../../local/assistant/user-resources.js";
import type { Visit } from "../../package/sync.js";
import { createCheckpointExtension } from "../checkpoint/extension.js";
import { formatEnvironmentPrompt } from "../environment.js";
import { createArtifactsExtension } from "../history/artifacts.js";
import { createDeliverablesExtension } from "../history/deliverables.js";
import { healInterruptedSessionTools } from "../history/history.js";
import { createReplyModelExtension } from "../history/reply-model.js";
import { createSummaryExtension } from "../history/summary.js";
import { ApprovalBroker, createApprovalExtension } from "../hitl/approval/index.js";
import { hitlScopeFields, type HitlExtensionContext } from "../hitl/origin.js";
import { createShellHangExtension, type ShellHangBroker } from "../hitl/shell-hang/index.js";
import { artifactDeliveryTools } from "../external/mcp/artifact-tools.js";
import type { McpTool } from "../external/mcp/server.js";
import { syncSkillsProject } from "../external/skills-project.js";
import { openModelRuntime } from "../model/runtime.js";
import { writeSessionModelRef } from "../model/session-model.js";
import { createOutputLengthExtension } from "../output-length.js";
import { buildSessionPlan } from "../plan.js";
import { createDefaultSamplingExtension } from "../sampling.js";
import { createStreamGuardExtension } from "../stream-guard.js";
import {
  createDeliverArtifactsExtension,
  type DeliverArtifactsState,
} from "../tools/deliver-artifacts.js";
import { createFsGuardExtension } from "../tools/fs-guard.js";
import { AskUserBroker, createAskUserExtension } from "../tools/ask-user.js";
import { createLocalTimeExtension } from "../tools/local-time.js";
import { createTodoExtension } from "../tools/todo.js";
import { createWebToolsExtension } from "../tools/web.js";
import { projectVisitAgentsMd } from "../workspace/agents-md.js";
import { snapshotArtifactDir } from "../workspace/artifact-diff.js";
import { ensureCwdLayout } from "../workspace/cwd-layout.js";
import { mergeVisitMcp, projectVisitMcp } from "../workspace/mcp.js";
import { resolveAllowedRoots } from "../workspace/project-roots.js";
import { compileSystemPrompt } from "../context/prompt-policy.js";
import { executionModeOf } from "../context/mode.js";
import { resolveExecutionTools } from "../context/tool-policy.js";
import { userDataRootFromVisit } from "../context/user-data-root.js";
import { sessionProjectRoots, WORKSPACE_POLICY } from "../context/workspace-policy.js";
import { hitlContextFor, type ConversationRef } from "./conversation-ref.js";
import { profileForMode, type SessionProfileServices } from "./session-profile.js";
import { ensureGroupWorkspace, groupDirPath, isGroupWorkspaceReadOnly } from "../group/workspace.js";
import { createCompleteGroupTaskExtension } from "../tools/complete-group-task.js";

export type ParentSessionExtensions = {
  /** 插在产物快照之后，例如委托附件收件箱。 */
  afterArtifacts?: ExtensionFactory[];
  /** 插在检查点之后、MCP 之前，例如再委托和后台任务。 */
  afterShell?: ExtensionFactory[];
  resolveDelegationLabel?: (toAgentId: string) => Promise<string | undefined>;
  /** 收口交付网格：列出尚未 presented 的委托产物。 */
  listDeliverablesPending?: () => {
    taskId: string;
    files: { path: string; size?: number }[];
  }[];
  markDeliverablesPresented?: (taskIds: readonly string[]) => void;
};

type SharedOpen = {
  visit: Visit;
  model: ModelConfig;
  approvals: ApprovalBroker;
  askUser: AskUserBroker;
  shellHang?: ShellHangBroker;
  /**
   * 一对一才会用到。委托配置会忽略这里，避免子会话再委托或收后台任务。
   * 由调用方提供，以免本模块去加载委托服务（那会和 run 互相引用）。
   */
  parentExtensions?: (scope: { cwd: string; groupId?: string }) => ParentSessionExtensions;
  /**
   * 交给外部 agent（本地 Agent App）的 MCP 工具，按 cwd 现算（§12.7 / §12.9）。
   * 子会话（kind=delegation）不传 → 天然不再嵌套委托。
   */
  externalMcp?: (scope: { cwd: string; groupId?: string }) => McpTool[];
};

export type ProfiledSessionRequest = SharedOpen &
  (
    | {
        kind: "interactive" | "group-holder";
        conversation?: ConversationRef;
        sessionDir?: string;
        services?: SessionProfileServices;
        /** 群执掌：除自己外的成员名片。一对一不传。 */
        groupRosterPrompt?: string;
      }
    | {
        kind: "delegation";
        taskId: string;
        parentAgentId: string;
        /** 专员显示名：群共享 `from-<name>-<taskId>` 目录。 */
        toAgentName?: string;
        groupId?: string;
        sessionDir: string;
      }
  );

export type OpenedProfiledSession = {
  result: CreateAgentSessionResult;
  sessionManager: SessionManager;
  deliverState?: DeliverArtifactsState;
};

export async function openProfiledSession(input: ProfiledSessionRequest): Promise<OpenedProfiledSession> {
  if (input.kind === "group-holder" && input.conversation?.kind !== "group") {
    throw new Error("群执掌会话需要群身份");
  }
  const groupId =
    input.kind === "delegation"
      ? input.groupId
      : input.conversation?.kind === "group"
        ? input.conversation.groupId
        : undefined;
  const mode = executionModeOf({ kind: input.kind, groupId });
  const profile = profileForMode(mode, input.kind === "delegation" ? {} : input.services);
  const visit = input.visit;
  const plan = buildSessionPlan(
    visit,
    input.model,
    input.kind !== "delegation" && input.sessionDir ? { sessionDir: input.sessionDir } : undefined,
  );
  const sessionDir = input.kind === "delegation" ? input.sessionDir : plan.sessionDir;
  if (profile.session === "fresh") fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(plan.cwd, { recursive: true });
  ensureCwdLayout(plan.cwd);
  // 方案 D：agent-sdk 按厂商路径投影 skills；API/Pi 或未声明路径则清掉旧链（切 provider 必走这里）。
  syncSkillsProject({
    cwd: plan.cwd,
    templateId: input.model.templateId,
    visit,
    userDataRoot: userDataRootFromVisit(visit),
  });
  const personal = visit.kind === "personal";
  const workspacePolicy = WORKSPACE_POLICY[mode];
  const groupWorkspace =
    workspacePolicy.includeGroupWorkspace && groupId
      ? ensureGroupWorkspace(userDataRootFromVisit(visit), visit.userId, groupId)
      : undefined;
  /** 群级挂载目录：群会话的 HITL 挂载提议写进群 settings.json，而不是成员自己的 instance.json。 */
  const groupProjectDir =
    workspacePolicy.includeGroupProjectRoots && groupId
      ? groupDirPath(userDataRootFromVisit(visit), visit.userId, groupId)
      : undefined;
  if (!personal) projectVisitAgentsMd(visit.root);

  const hitl: HitlExtensionContext =
    input.kind === "delegation"
      ? {
          origin: "delegation",
          taskId: input.taskId,
          parentAgentId: input.parentAgentId,
          ...(input.groupId ? { groupId: input.groupId } : {}),
        }
      : input.conversation
        ? hitlContextFor(input.conversation)
        : { origin: "visit" };
  const resourceRoot = profile.personalSkills && personal ? visit.root : undefined;
  const packageSkills = path.join(plan.cwd, ".pi", "skills");
  const personalSkills = resourceRoot ? path.join(resourceRoot, "skills") : undefined;
  const mcpConfig =
    profile.personalMcp && personal && resourceRoot
      ? mergeVisitMcp(plan.cwd, resourceRoot, visit.userId)
      : projectVisitMcp(plan.cwd, visit.userId);
  const mcpEnabled = mcpConfig.servers.length > 0;
  const settingsManager = SettingsManager.create(plan.cwd, plan.agentDir, { projectTrusted: true });
  // API/Pi：开内建 compact；阈值 = model.contextWindow - reserveTokens（窗长见 openModelRuntime）
  settingsManager.setCompactionEnabled(true);
  const deliverState: DeliverArtifactsState | undefined =
    profile.deliverArtifacts || profile.completeGroupTask ? { confirmed: false, staged: [] } : undefined;
  const artifactBefore = profile.deliverArtifacts ? snapshotArtifactDir(plan.cwd) : undefined;
  const wantsParent =
    profile.delegationInbox || profile.delegateTool || profile.backgroundTool || profile.delegationLabels;
  const parent = wantsParent ? input.parentExtensions?.({ cwd: plan.cwd, groupId: hitl.groupId }) ?? {} : {};
  const groupRosterPrompt = input.kind === "group-holder" ? input.groupRosterPrompt : undefined;
  const sessionTools = resolveExecutionTools(mode, {
    shellTools: plan.environment.shellTools,
    mcp: mcpEnabled,
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: plan.cwd,
    agentDir: plan.agentDir,
    settingsManager,
    // 不走 Pi 包管理器 / ~/.agents：第三方只加载运行包；私人助理只额外加载自己的 skills。
    noSkills: true,
    additionalSkillPaths: [
      ...(fs.existsSync(packageSkills) ? [packageSkills] : []),
      ...(personalSkills && fs.existsSync(personalSkills) ? [personalSkills] : []),
    ],
    extensionFactories: [
      createFsGuardExtension(plan.cwd, () => {
        // 每次工具调用现读盘（一对一=visit 挂载；群=群挂载），UI 挂载后无需重开会话。
        const projectRoots = sessionProjectRoots({ policy: workspacePolicy, visit, groupId });
        const roots = workspacePolicy.includePrivateCwd ? resolveAllowedRoots(plan.cwd, projectRoots) : projectRoots;
        return groupWorkspace ? [...roots, groupWorkspace.root] : roots;
      }, {
        isReadOnly: groupWorkspace
          ? (absolutePath) => isGroupWorkspaceReadOnly(groupWorkspace, absolutePath)
          : undefined,
      }),
      createWebToolsExtension(),
      createLocalTimeExtension(),
      createAskUserExtension(input.askUser, visit.userId, visit.agentId, hitl),
      createTodoExtension(),
      // 每轮回复记下 provider/模型（与 summary 同形 custom entry），历史气泡可还原标形。
      createReplyModelExtension(input.model, userDataRootFromVisit(visit)),
      ...(profile.summary ? [createSummaryExtension()] : []),
      ...(profile.artifactPanel ? [createArtifactsExtension()] : []),
      ...(profile.delegationInbox ? parent.afterArtifacts ?? [] : []),
      // 一对一 / 执掌：交付网格（自动挂委托产物 + present_artifacts）
      ...(profile.mode === "single" || profile.mode === "group-holder"
        ? [
            createDeliverablesExtension({
              cwd: plan.cwd,
              listPending: parent.listDeliverablesPending ?? (() => []),
              markPresented: parent.markDeliverablesPresented ?? (() => {}),
            }),
          ]
        : []),
      ...(profile.deliverArtifacts && deliverState && artifactBefore
        ? [createDeliverArtifactsExtension({ cwd: plan.cwd, before: artifactBefore, state: deliverState })]
        : []),
      ...(profile.completeGroupTask && deliverState && groupWorkspace
        ? [createCompleteGroupTaskExtension({ workspaceRoot: groupWorkspace.root, state: deliverState })]
        : []),
      createOutputLengthExtension(),
      createStreamGuardExtension(),
      createCheckpointExtension(visit.root),
      ...(input.shellHang
        ? [
            createShellHangExtension(input.shellHang, visit.userId, visit.agentId, {
              cwd: plan.cwd,
              shellTools: plan.environment.shellTools,
              hitl,
            }),
          ]
        : []),
      ...(profile.delegateTool || profile.backgroundTool ? parent.afterShell ?? [] : []),
      ...(mcpEnabled
        ? [createToolSearchExtension(), createCodemodeExtension(), createMcpExtension({ loadConfig: () => mcpConfig })]
        : []),
      createApprovalExtension(input.approvals, visit.userId, visit.agentId, {
        hitl,
        projectMount: {
          cwd: plan.cwd,
          visitRoot: groupProjectDir ?? visit.root,
          kind: groupProjectDir ? "group" : personal ? "personal" : "agent",
          userDataRoot: userDataRootFromVisit(visit),
          ...(groupWorkspace ? { trustedRoots: [groupWorkspace.root] } : {}),
        },
        resolveDelegationLabel: profile.delegationLabels ? parent.resolveDelegationLabel : undefined,
      }),
      createDefaultSamplingExtension(),
    ],
    disabledBuiltinExtensions: mcpEnabled ? [] : ["mcp"],
    skillsOverride: (loaded) => {
      const enabledPersonalSkills = resourceRoot ? listEnabledUserSkillPaths(resourceRoot) : [];
      return {
        skills: loaded.skills.filter(
          (skill) =>
            skillUnderRoot(skill, packageSkills) ||
            enabledPersonalSkills.some((skillDir) => skillUnderRoot(skill, skillDir)),
        ),
        diagnostics: loaded.diagnostics,
      };
    },
    appendSystemPromptOverride: (base) => {
      return compileSystemPrompt(base, {
        mode,
        environment: formatEnvironmentPrompt(plan.environment, plan.cwd),
        commandTool: plan.environment.commandTool,
        collaborationEnabled: profile.collaborationPrompt,
        projectRoots: sessionProjectRoots({ policy: workspacePolicy, visit, groupId }),
        ...(groupWorkspace ? { groupWorkspace } : {}),
        ...(groupRosterPrompt ? { groupRoster: groupRosterPrompt } : {}),
        ...(input.kind === "delegation"
          ? {
              taskId: input.taskId,
              ...(input.toAgentName ? { toAgentName: input.toAgentName } : {}),
            }
          : {}),
      });
    },
  });
  await resourceLoader.reload();
  // 本地 Agent App：信任模式（bypass）下工具不弹 HITL；AskUser 仍接提问通道。
  const { runtime, model: registered, externalQuery } = await openModelRuntime(plan, {
    userDataRoot: userDataRootFromVisit(visit),
    // approvals 仍注入以保持接线形状；canUseTool 信任模式下不再 request。
    approvals: {
      request: (request, signal) => input.approvals.request(request, signal),
      allowsTool: (toolName) => input.approvals.allowsTool(visit.userId, visit.agentId, toolName),
    },
    // AskUserQuestion 不是工具权限：等待 AskUserBroker 的答案，再回填 SDK updatedInput.answers。
    askUser: {
      request: (request, signal) =>
        input.askUser.request({ ...request, ...hitlScopeFields(hitl) }, signal),
    },
    userId: visit.userId,
    agentId: visit.agentId,
    // 外部 agent 接入时按 visit 现拼上下文（人设 / AGENTS.md / 挂载目录）
    visit,
    workspacePolicy,
    ...(groupId ? { groupId } : {}),
    ...(groupWorkspace ? { groupWorkspaceRoot: groupWorkspace.root } : {}),
    ...(groupRosterPrompt ? { groupRosterPrompt } : {}),
    // SDK：委托确认工具挂 MCP（与 Pi extension 同写 deliverState）；父会话另挂委托协调工具。
    // 子会话不传 externalMcp → 天然不嵌套 delegate（围栏）。
    mcpTools: [
      ...artifactMcpToolsForProfile({
        profile,
        deliverState,
        cwd: plan.cwd,
        groupWorkspaceRoot: groupWorkspace?.root,
      }),
      ...(input.externalMcp?.({ cwd: plan.cwd, ...(groupId ? { groupId } : {}) }) ?? []),
    ],
  });
  const tools = sessionTools.length > 0 ? sessionTools : undefined;
  const sessionManager =
    profile.session === "fresh"
      ? openFreshSession(plan.cwd, sessionDir)
      : SessionManager.continueRecent(plan.cwd, sessionDir);
  if (profile.healInterrupted) {
    const skipToolCallIds = new Set<string>([
      ...input.approvals.pendingToolCallIds(visit.userId, visit.agentId),
      ...input.askUser.pendingToolCallIds(visit.userId, visit.agentId),
    ]);
    healInterruptedSessionTools(sessionManager, { skipToolCallIds });
  }
  const sessionFile = sessionManager.getSessionFile();
  if (profile.persistModelRef && sessionFile) {
    writeSessionModelRef(sessionFile, { templateId: input.model.templateId, modelId: input.model.modelId });
  }
  const options: CreateAgentSessionOptions = {
    cwd: plan.cwd,
    agentDir: plan.agentDir,
    modelRuntime: runtime,
    settingsManager,
    resourceLoader,
    sessionManager,
    model: registered,
    tools,
    thinkingLevel: "off",
    noTools: tools ? undefined : mcpEnabled ? "builtin" : "all",
  };
  const result = await createAgentSession(options);
  await result.session.bindExtensions({});
  if (externalQuery) {
    // SDK 直连流挂在会话最小面上；VisitChats 据此切到 runExternalTurn。
    (result.session as typeof result.session & { externalQuery?: typeof externalQuery }).externalQuery =
      externalQuery;
  }
  return { result, sessionManager, deliverState };
}

/** 按 profile 挂 SDK 产物确认 MCP；无 deliverState 或非委托确认场景返回空。 */
function artifactMcpToolsForProfile(input: {
  profile: ReturnType<typeof profileForMode>;
  deliverState?: DeliverArtifactsState;
  cwd: string;
  groupWorkspaceRoot?: string;
}): McpTool[] {
  const { profile, deliverState, cwd, groupWorkspaceRoot } = input;
  if (!deliverState) return [];
  if (profile.completeGroupTask && groupWorkspaceRoot) {
    return artifactDeliveryTools({
      kind: "complete_group_task",
      workspaceRoot: groupWorkspaceRoot,
      state: deliverState,
    });
  }
  if (profile.deliverArtifacts) {
    return artifactDeliveryTools({
      kind: "deliver_artifacts",
      cwd,
      state: deliverState,
    });
  }
  return [];
}

function openFreshSession(cwd: string, sessionDir: string): SessionManager {
  const created = SessionManager.create(cwd, sessionDir);
  const sessionFile = created.getSessionFile();
  if (!sessionFile) throw new Error("无法创建委托会话");
  fs.writeFileSync(sessionFile, "");
  return SessionManager.open(sessionFile, sessionDir, cwd);
}

function skillUnderRoot(skill: Skill, rootDir: string): boolean {
  if (!rootDir) return false;
  const file = path.resolve(skill.filePath);
  const root = path.resolve(rootDir);
  return file === root || file.startsWith(`${root}${path.sep}`);
}

