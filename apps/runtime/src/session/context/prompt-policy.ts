import type { CommandToolName } from "../environment.js";
import {
  formatCollaborationPrompt,
  formatGroupCollaborationPrompt,
} from "../delegation/collaboration-prompt.js";
import { formatToolsUsagePrompt } from "../tools/usage-prompt.js";
import { formatCwdLayoutPrompt } from "../workspace/cwd-layout.js";
import { formatProjectRootsPrompt } from "../workspace/project-roots.js";
import { groupWorkspacePrompt, type GroupWorkspace } from "../group/workspace.js";
import { groupTaskDirName } from "../tools/deliver-artifacts.js";
import type { ExecutionMode } from "./mode.js";
import { TOOL_POLICY } from "./tool-policy.js";

export type PromptSectionId =
  | "environment"
  | "private-cwd"
  | "group-workspace"
  | "tool-usage"
  | "project-roots"
  | "single-collaboration"
  | "group-collaboration"
  | "group-roster"
  | "group-task";

/** 每种场景的系统提示段落顺序。空段落在编译时丢掉。 */
export const PROMPT_SECTIONS: Record<ExecutionMode, readonly PromptSectionId[]> = {
  single: ["environment", "private-cwd", "tool-usage", "project-roots", "single-collaboration"],
  "group-holder": ["environment", "group-workspace", "project-roots", "tool-usage", "group-collaboration", "group-roster"],
  "single-delegation": ["environment", "private-cwd", "tool-usage"],
  "group-delegation": ["environment", "group-workspace", "project-roots", "tool-usage", "group-task"],
};

export type PromptCompileInput = {
  mode: ExecutionMode;
  environment: string;
  commandTool: CommandToolName;
  collaborationEnabled: boolean;
  projectRoots: string[];
  groupWorkspace?: GroupWorkspace;
  groupRoster?: string;
  taskId?: string;
  /** 群委托专员显示名，拼进 `from-<name>-<taskId>`。 */
  toAgentName?: string;
};

export function compileSystemPrompt(base: readonly string[], input: PromptCompileInput): string[] {
  const parts = [...base];
  for (const section of PROMPT_SECTIONS[input.mode]) {
    const text = renderSection(section, input);
    if (text) parts.push(text);
  }
  return parts;
}

function renderSection(section: PromptSectionId, input: PromptCompileInput): string {
  switch (section) {
    case "environment":
      return input.environment;
    case "private-cwd":
      return formatCwdLayoutPrompt();
    case "group-workspace":
      return input.groupWorkspace ? groupWorkspacePrompt(input.groupWorkspace) : "";
    case "tool-usage": {
      const tools = TOOL_POLICY[input.mode];
      return formatToolsUsagePrompt(input.commandTool, {
        background: tools.includes("bg_run"),
        toolSearch: tools.includes("tool_search"),
      });
    }
    case "project-roots":
      return formatProjectRootsPrompt(input.projectRoots);
    case "single-collaboration":
      return input.collaborationEnabled ? formatCollaborationPrompt(input.commandTool) : "";
    case "group-collaboration":
      return input.collaborationEnabled ? formatGroupCollaborationPrompt(input.commandTool) : "";
    case "group-roster":
      return input.groupRoster?.trim() ?? "";
    case "group-task":
      return formatGroupTaskPrompt(input.taskId, input.toAgentName);
    default:
      return "";
  }
}

function formatGroupTaskPrompt(taskId: string | undefined, toAgentName?: string): string {
  const folder = groupTaskDirName(taskId?.trim() || "task", toAgentName);
  return [
    "# Group task delivery",
    "",
    "You are doing one group task. Do not delegate further.",
    `Write in-progress files under the shared group \`WORK/${folder}/\`.`,
    `Write finished files under the shared group \`ARTIFACT/${folder}/\`.`,
    "Do not modify shared ATTACHMENTS/, and do not write these files into your private cwd.",
    "When you finish, call complete_group_task with those relative paths and what the group should do next.",
    "Do not copy files into the caller's private workspace.",
  ].join("\n");
}
