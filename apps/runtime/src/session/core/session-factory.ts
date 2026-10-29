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
import { healInterruptedSessionTools } from "../history/history.js";
import { createSummaryExtension } from "../history/summary.js";
import { ApprovalBroker, createApprovalExtension } from "../hitl/approval/index.js";
import type { HitlExtensionContext } from "../hitl/origin.js";
import { createShellHangExtension, type ShellHangBroker } from "../hitl/shell-hang/index.js";
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
      ...(profile.summary ? [createSummaryExtension()] : []),
      ...(profile.artifactPanel ? [createArtifactsExtension()] : []),
      ...(profile.delegationInbox ? parent.afterArtifacts ?? [] : []),
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
  const { runtime, model: registered } = await openModelRuntime(plan);
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
  return { result, sessionManager, deliverState };
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

