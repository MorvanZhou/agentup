import fs from "node:fs";
import path from "node:path";

import {
  createAgentSession,
  createMcpExtension,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
  type Skill,
} from "@earendil-works/pi-coding-agent";

import type { ModelConfig } from "../config/load.js";
import { listEnabledUserSkillPaths } from "../local/user-resources.js";
import type { Visit } from "../package/sync.js";
import { ApprovalBroker, createApprovalExtension } from "./approval.js";
import { createCheckpointExtension } from "./checkpoint-ext.js";
import type { DelegationService } from "./delegation/index.js";
import { healInterruptedSessionTools } from "./history.js";
import { mergeVisitMcp, projectVisitMcp } from "./mcp.js";
import { openModelRuntime } from "./model-runtime.js";
import { formatCollaborationPrompt } from "./collaboration-prompt.js";
import { ensureCwdLayout, formatCwdLayoutPrompt } from "./cwd-layout.js";
import { buildSessionPlan } from "./plan.js";
import { projectVisitAgentsMd } from "./agents-md.js";
import { writeSessionModelRef } from "./session-model.js";
import { createSummaryExtension } from "./summary.js";
import {
  AskUserBroker,
  createAskUserExtension,
  createDelegateExtension,
  createTodoExtension,
  createWebToolsExtension,
} from "./tools/index.js";

export async function openSession(
  visit: Visit,
  model: ModelConfig,
  approvals = new ApprovalBroker(),
  askUser = new AskUserBroker(),
  delegation?: DelegationService,
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
      createWebToolsExtension(),
      createAskUserExtension(askUser, visit.userId, visit.agentId),
      createTodoExtension(),
      createSummaryExtension(),
      createCheckpointExtension(visit.root),
      ...(delegation
        ? [createDelegateExtension(delegation, visit.userId, visit.agentId)]
        : []),
      ...(mcpEnabled ? [createMcpExtension({ loadConfig: () => mcpConfig })] : []),
      createApprovalExtension(approvals, visit.userId, visit.agentId, {
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
    // 平台 cwd 规范 +（有委托时）协作策略；工作规则由 agentDir AGENTS.md 加载。
    appendSystemPromptOverride: (base) => {
      const parts = [...base, formatCwdLayoutPrompt()];
      if (delegation) parts.push(formatCollaborationPrompt());
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
  return createAgentSession(options);
}

function skillUnderRoot(skill: Skill, rootDir: string): boolean {
  if (!rootDir) return false;
  const file = path.resolve(skill.filePath);
  const root = path.resolve(rootDir);
  return file === root || file.startsWith(`${root}${path.sep}`);
}
