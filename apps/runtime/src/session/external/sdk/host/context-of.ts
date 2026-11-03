import {
  buildExternalAgentContext,
  type ExternalAgentContext,
} from "../../context.js";
import { syncSkillsProject } from "../../skills-project.js";
import type { AgentSdkStreamContext } from "./types.js";

/** 每轮再 sync skills + 拼中立 ExternalAgentContext；失败则退回 null（只给 cwd）。 */
export function externalContextOf(ctx: AgentSdkStreamContext): ExternalAgentContext | null {
  if (!ctx.visit) return null;
  try {
    const projected = syncSkillsProject({
      cwd: ctx.cwd,
      templateId: ctx.templateId,
      visit: ctx.visit,
      userDataRoot: ctx.userDataRoot,
    });
    return buildExternalAgentContext({
      visit: ctx.visit,
      cwd: ctx.cwd,
      userDataRoot: ctx.userDataRoot,
      ...(ctx.workspacePolicy ? { policy: ctx.workspacePolicy } : {}),
      ...(ctx.groupId ? { groupId: ctx.groupId } : {}),
      ...(ctx.groupWorkspaceRoot ? { groupWorkspaceRoot: ctx.groupWorkspaceRoot } : {}),
      ...(ctx.agentName ? { agentName: ctx.agentName } : {}),
      ...(projected.rel ? { skillsProjectRel: projected.rel } : {}),
      ...(ctx.groupRosterPrompt ? { groupRoster: ctx.groupRosterPrompt } : {}),
    });
  } catch {
    return null;
  }
}
