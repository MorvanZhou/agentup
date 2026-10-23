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
  type Skill,
} from "@earendil-works/pi-coding-agent";

import type { ModelConfig } from "../config/load.js";
import { listEnabledUserSkillPaths } from "../local/assistant/user-resources.js";
import type { Visit } from "../package/sync.js";
import { ApprovalBroker, createApprovalExtension } from "./hitl/approval/index.js";
import { createCheckpointExtension } from "./checkpoint/extension.js";
import type { BackgroundJobs } from "./background/index.js";
import type { DelegationService } from "./delegation/index.js";
import { healInterruptedSessionTools } from "./history/history.js";
import { mergeVisitMcp, projectVisitMcp } from "./workspace/mcp.js";
import { openModelRuntime } from "./model/runtime.js";
import { formatCollaborationPrompt } from "./delegation/collaboration-prompt.js";
import { formatEnvironmentPrompt } from "./environment.js";
import { ensureCwdLayout, formatCwdLayoutPrompt } from "./workspace/cwd-layout.js";
import {
  formatProjectRootsPrompt,
  readProjectRoots,
  resolveAllowedRoots,
} from "./workspace/project-roots.js";
import { buildSessionPlan } from "./plan.js";
import { projectVisitAgentsMd } from "./workspace/agents-md.js";
import { writeSessionModelRef } from "./model/session-model.js";
import { createArtifactsExtension } from "./history/artifacts.js";
import { createSummaryExtension } from "./history/summary.js";
import { createOutputLengthExtension } from "./output-length.js";
import { createStreamGuardExtension } from "./stream-guard.js";
import {
  AskUserBroker,
  createAskUserExtension,
  createBackgroundJobsExtension,
  createDelegateExtension,
  createFsGuardExtension,
  createLocalTimeExtension,
  createTodoExtension,
  createWebToolsExtension,
  formatToolsUsagePrompt,
} from "./tools/index.js";

export async function openSession(
  visit: Visit,
  model: ModelConfig,
  approvals = new ApprovalBroker(),
  askUser = new AskUserBroker(),
  delegation?: DelegationService,
  backgroundJobs?: BackgroundJobs,
): Promise<CreateAgentSessionResult> {
  const plan = buildSessionPlan(visit, model);
  fs.mkdirSync(plan.cwd, { recursive: true });
  ensureCwdLayout(plan.cwd);
  const personal = visit.kind === "personal";
  if (!personal) projectVisitAgentsMd(visit.root);
  const resourceRoot = personal ? visit.root : undefined;
  const packageSkills = path.join(plan.cwd, ".pi", "skills");
  const personalSkills = resourceRoot ? path.join(resourceRoot, "skills") : undefined;
  const mcpConfig = personal && resourceRoot
    ? mergeVisitMcp(plan.cwd, resourceRoot, visit.userId)
    : projectVisitMcp(plan.cwd, visit.userId);
  const mcpEnabled = mcpConfig.servers.length > 0;
  const settingsManager = SettingsManager.create(plan.cwd, plan.agentDir, { projectTrusted: true });
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
        const kind = visit.kind === "personal" ? "personal" : "agent";
        return resolveAllowedRoots(plan.cwd, readProjectRoots(visit.root, kind));
      }),
      createWebToolsExtension(),
      createLocalTimeExtension(),
      createAskUserExtension(askUser, visit.userId, visit.agentId, { origin: "visit" }),
      createTodoExtension(),
      createSummaryExtension(),
      createArtifactsExtension(),
      createOutputLengthExtension(),
      createStreamGuardExtension(),
      createCheckpointExtension(visit.root),
      ...(delegation
        ? [createDelegateExtension(delegation, visit.userId, visit.agentId)]
        : []),
      ...(backgroundJobs
        ? [createBackgroundJobsExtension(backgroundJobs, visit.userId, visit.agentId, plan.cwd)]
        : []),
      // MCP deferred → tool_search；包若显式 codemode 则由 MCP 扩展激活 codemode。
      ...(mcpEnabled
        ? [createToolSearchExtension(), createCodemodeExtension(), createMcpExtension({ loadConfig: () => mcpConfig })]
        : []),
      createApprovalExtension(approvals, visit.userId, visit.agentId, {
        hitl: { origin: "visit" },
        projectMount: {
          cwd: plan.cwd,
          visitRoot: visit.root,
          kind: personal ? "personal" : "agent",
          userDataRoot: userDataRootFromVisit(visit),
        },
        resolveDelegationLabel: delegation
          ? async (toAgentId) => {
              const agents = await delegation.listRecruited(visit.userId);
              const card = agents.find((item) => item.agentId === toAgentId);
              if (!card) return undefined;
              const label = (card.remark || card.name).trim();
              return label || undefined;
            }
          : undefined,
      }),
    ],
    disabledBuiltinExtensions: mcpEnabled ? [] : ["mcp"],
    // 运行包 skills 全保留；私人助理只留 skills-state.json 已激活的项。
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
    // 平台环境 + cwd 规范 + 挂载项目根 +（有委托时）协作策略；工作规则由 agentDir AGENTS.md 加载。
    appendSystemPromptOverride: (base) => {
      const kind = visit.kind === "personal" ? "personal" : "agent";
      const projectRoots = readProjectRoots(visit.root, kind);
      const commandTool = plan.environment.commandTool;
      const parts = [
        ...base,
        formatEnvironmentPrompt(plan.environment, plan.cwd),
        formatCwdLayoutPrompt(),
        formatToolsUsagePrompt(commandTool),
      ];
      const projectPrompt = formatProjectRootsPrompt(projectRoots);
      if (projectPrompt) parts.push(projectPrompt);
      if (delegation) parts.push(formatCollaborationPrompt(commandTool));
      return parts;
    },
  });
  await resourceLoader.reload();
  const { runtime, model: registered } = await openModelRuntime(plan);
  const tools = plan.tools.length > 0 ? plan.tools : undefined;
  const sessionManager = SessionManager.continueRecent(plan.cwd, plan.sessionDir);
  const skipToolCallIds = new Set<string>([
    ...approvals.pendingToolCallIds(visit.userId, visit.agentId),
    ...askUser.pendingToolCallIds(visit.userId, visit.agentId),
  ]);
  healInterruptedSessionTools(sessionManager, { skipToolCallIds });
  // 锚定本 Pi session 使用的 AgentUp 模型（sidecar；空会话也能落盘）
  const sessionFile = sessionManager.getSessionFile();
  if (sessionFile) {
    writeSessionModelRef(sessionFile, { templateId: model.templateId, modelId: model.modelId });
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
  const created = await createAgentSession(options);
  // SDK 不会自动 session_start；MCP 在此连接，deferred 才可被 tool_search 发现。
  await created.session.bindExtensions({});
  return created;
}

function skillUnderRoot(skill: Skill, rootDir: string): boolean {
  if (!rootDir) return false;
  const file = path.resolve(skill.filePath);
  const root = path.resolve(rootDir);
  return file === root || file.startsWith(`${root}${path.sep}`);
}

/** visit.root → `<user_data_root>`（agents 三级上、私人助理两级上）。 */
function userDataRootFromVisit(visit: Visit): string {
  if (visit.kind === "personal") return path.resolve(visit.root, "..", "..");
  return path.resolve(visit.root, "..", "..", "..");
}
