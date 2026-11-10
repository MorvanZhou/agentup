import fs from "node:fs";
import path from "node:path";

import type { Visit } from "../../package/sync.js";
import {
  delegationBriefLocationRule,
  groupHandoffLocationRule,
} from "../delegation/collaboration-prompt.js";
import { detectHostEnvironment, type HostEnvironment } from "../environment.js";
import { listVisitSkills, type InvocableSkill } from "../skills/skills.js";
import { WORKSPACE_POLICY, sessionProjectRoots, type WorkspacePolicy } from "../context/workspace-policy.js";
import { resolveAllowedRoots } from "../workspace/project-roots.js";

/**
 * 外部 Agent（本地 Agent App / SDK）的上下文拼接层。
 * 独立于 `session/context/prompt-policy.ts`：那份是给 Pi 写的，里面全是 Pi 的工具名与路径规矩，
 * 喂给外部 agent 只会误导它。这一层只读磁盘 + 目录策略，产出中立形状，再由各 SDK 的 adapter
 * 转成自己的 options（`systemPrompt.append` / `additionalDirectories` / `mcpServers`）。
 * 背景见 .cursor/skills/agentup-sdk-adapter/references/context-and-approvals.md 与 context-and-approvals.md（skill references）。
 */

/** AGENTS.md 上限：与 CodeBuddy CLI 自己的 `AGENTS.md` 记忆上限对齐（4e4）。 */
export const MAX_AGENTS_MD_CHARS = 40_000;
/** 单文件读取上限：SYSTEM.md 之类不该很大，防异常文件把上下文撑爆。 */
const MAX_FILE_CHARS = 200_000;

export type ExternalAgentContextInput = {
  visit: Visit;
  /** visit 的工作目录（`users/<uid>/agents/<id>/cwd`）。 */
  cwd: string;
  groupId?: string;
  userDataRoot?: string;
  /** 执行场景（决定挂载目录从哪读）；默认一对一。 */
  policy?: WorkspacePolicy;
  /** 群工作区目录（`includeGroupWorkspace` 时并入可访问目录）。 */
  groupWorkspaceRoot?: string;
  /** 会话名（便于它知道自己在跟谁说话）。 */
  agentName?: string;
  /** 测试/群场景可直给；不给就按目录策略现算。 */
  projectRoots?: string[];
  skills?: InvocableSkill[];
  /**
   * 方案 D：当前厂商 skills 投影相对路径（如 `.codebuddy/skills`）。
   * 有值时写入 append，引导用自带 Skill / 读文件，而不是 MCP skill_*。
   */
  skillsProjectRel?: string;
  /**
   * 群执掌：已格式化的 `# Group members` 块（含 agent_id）。
   * 有值时改用群协作契约，不再注入单聊 `agent_search` 口径。
   */
  groupRoster?: string;
  model?: string;
};

export type ExternalAgentContext = {
  /** 追加到外部 agent 系统提示后面的块（人设 + 工作规则 + 技能清单 + 目录 + 边界）。 */
  systemAppend: string;
  cwd: string;
  /** 除 cwd 之外可访问的目录（挂载目录 / 群工作区）。 */
  additionalDirs: string[];
  model?: string;
};

export function buildExternalAgentContext(input: ExternalAgentContextInput): ExternalAgentContext {
  const { visit, cwd, userDataRoot } = input;
  const roots =
    input.projectRoots ??
    sessionProjectRoots({ policy: input.policy ?? WORKSPACE_POLICY.single, visit, groupId: input.groupId });
  const candidates = input.groupWorkspaceRoot ? [...roots, input.groupWorkspaceRoot] : roots;
  const allowed = resolveAllowedRoots(cwd, candidates);
  // resolveAllowedRoots 会把 cwd 也算进来，且内部走 realpath（/var → /private/var）；
  // 这里同样比 realpath，否则 macOS 上去不掉 cwd 自己。
  const cwdReal = realOrSelf(cwd);
  const additionalDirs = allowed.filter((dir) => realOrSelf(dir) !== cwdReal);
  const skills = input.skills ?? readSkills(visit, userDataRoot);
  return {
    systemAppend: composeSystemAppend({
      agentName: input.agentName,
      persona: readPersona(visit, cwd),
      agentsMd: readAgentsMd(visit.root),
      skills,
      cwd,
      additionalDirs,
      ...(input.groupWorkspaceRoot ? { groupWorkspaceRoot: input.groupWorkspaceRoot } : {}),
      ...(input.skillsProjectRel ? { skillsProjectRel: input.skillsProjectRel } : {}),
      ...(input.groupRoster ? { groupRoster: input.groupRoster } : {}),
    }),
    cwd,
    additionalDirs,
    ...(input.model ? { model: input.model } : {}),
  };
}

export type SystemAppendInput = {
  agentName?: string;
  persona: string;
  agentsMd: string;
  skills: InvocableSkill[];
  cwd: string;
  additionalDirs: string[];
  /** 群共享工作区绝对根；有则在目录列表里标明相对 WORK/ARTIFACT 的解析基准。 */
  groupWorkspaceRoot?: string;
  /** 方案 D 厂商投影路径；写入技能段指引。 */
  skillsProjectRel?: string;
  /** 群花名册（含 agent_id）；有则走群协议而非单聊 Collaboration。 */
  groupRoster?: string;
  /** 测试可直给；默认现探测主机环境。 */
  environment?: HostEnvironment;
};

/**
 * 拼 append 块。刻意**不含** Pi 工具名（`bash` / `get_local_time` / `agent_search`）：
 * 外部 agent 用的是它自己的工具 + 我们挂的 MCP。Environment / Collaboration 用中立文案。
 * 不注入冻结的「当前时刻」——时间由 SDK 自管工具获取。
 */
export function composeSystemAppend(input: SystemAppendInput): string {
  const sections: string[] = [];
  const head = [
    "You are being invoked by AgentUp as a local Agent App. Follow the session background and boundaries below.",
  ];
  if (input.agentName) head.push(` Current session: ${input.agentName}.`);
  sections.push(head.join(""));

  sections.push(formatExternalEnvironmentPrompt(input.cwd, input.environment));

  if (input.persona.trim()) {
    sections.push(`## Your identity\n${input.persona.trim()}`);
  }
  if (input.agentsMd.trim()) {
    sections.push(`## Working rules (from AGENTS.md)\n${truncate(input.agentsMd.trim(), MAX_AGENTS_MD_CHARS)}`);
  }
  if (input.skills.length > 0) {
    const lines = input.skills.map((skill) => `- ${skill.name}: ${skill.description}`);
    const skillLines = [
      "## Available skills",
      ...lines,
      input.skillsProjectRel
        ? `Skill bodies live under \`${input.skillsProjectRel}/<name>/SKILL.md\` in the project directory (AgentUp projects them for the current local Agent App). Load them with your own Skill / file-read tools; do not call \`mcp__agentup__skill_*\`.`
        : "When you need a skill, load its instructions with your own Skill / file-read tools.",
    ];
    sections.push(skillLines.join("\n"));
  }
  const cwdNorm = input.cwd.replace(/\\/g, "/");
  const groupRoot = input.groupWorkspaceRoot?.trim().replace(/\\/g, "/") ?? "";
  const groupReal = groupRoot ? realOrSelf(groupRoot) : "";
  const dirLines = [cwdNorm, ...input.additionalDirs.map((dir) => dir.replace(/\\/g, "/"))].map(
    (dir) => {
      if (dir === cwdNorm) {
        return `- ${dir} (private Working directory — ordinary relative paths resolve here)`;
      }
      if (groupRoot && (dir === groupRoot || realOrSelf(dir) === groupReal)) {
        return `- ${dir} (shared group workspace — relative WORK/... and ARTIFACT/... for group tasks resolve here, not under your private cwd)`;
      }
      return `- ${dir}`;
    },
  );
  sections.push(
    [
      "## Directories you may read and write",
      ...dirLines,
      "Do not write outside the directories listed above; access to other paths will be denied.",
    ].join("\n"),
  );
  const roster = input.groupRoster?.trim() ?? "";
  if (roster) {
    sections.push(formatExternalGroupCollaborationPrompt());
    sections.push(roster);
  } else {
    sections.push(formatExternalCollaborationPrompt());
  }
  sections.push(formatExternalPreviewPrompt());
  sections.push(
    [
      "## Boundaries",
      "- You do not have AgentUp's built-in read / write / bash tools; use only your own tools for files and commands.",
      "- If this turn's MCP lists AgentUp tools (preview / delegation), you may call them as described; do not invent capabilities that are not listed. Skills do not go through MCP.",
      "- Writes and execution require user approval first; if refused, pick another approach — do not keep retrying.",
      "- Keep artifacts in the session working directory; do not write outside the list above.",
    ].join("\n"),
  );
  return sections.join("\n\n");
}

/** 静态主机环境；不含 Command tool / get_local_time / 当前时刻。 */
export function formatExternalEnvironmentPrompt(
  cwd: string,
  env: HostEnvironment = detectHostEnvironment(),
): string {
  return [
    "## Environment",
    "You are running in the following environment:",
    `- Platform: ${env.platform}`,
    `- Arch: ${env.arch}`,
    `- OS Version: ${env.osVersion}`,
    `- Working directory: ${cwd.replace(/\\/g, "/")}`,
  ].join("\n");
}

/**
 * 人侧 Launch Recipe：SDK 起本地服务后登记，供 Desktop 内嵌预览。
 * 不写 Pi `bg_run` / 裸 `present_preview`——起服用厂商 shell，登记走 MCP 全名。
 */
export function formatExternalPreviewPrompt(): string {
  return [
    "## AgentUp Preview",
    "",
    "After you start a local web server the user should see in the app, call `mcp__agentup__present_preview` with a short title, the localhost `preview_url`, and the shell command to restart that server.",
    "Static ARTIFACT HTML/Markdown/images use the file preview UI — do not call this tool for those.",
    "Browser automation uses platform Playwright MCP (`mcp__playwright__browser_*`), not this tool — do not invent a local Playwright/Bash harness when those tools are available.",
    "If Playwright tools are not listed, load/search the platform `playwright` MCP first; do not invent builtin `browser_*` tools.",
    "If `mcp__agentup__present_preview` is not listed this turn, do not invent it.",
  ].join("\n");
}

/**
 * MCP 协作契约（单聊）：只提真实挂载的 AgentUp MCP 名。
 * 不写裸 Pi 名（`agent_search` / `delegate_to_agent` 无前缀）——那是 API 模式工具面。
 */
export function formatExternalCollaborationPrompt(): string {
  return [
    "## AgentUp Collaboration",
    "",
    "Do only work that fits your own role. If another recruited agent is a better fit, call them via MCP and coordinate — do not do their job.",
    "When this turn's MCP lists AgentUp delegation tools, use these names:",
    "- `mcp__agentup__agent_search` — search the recruited specialist roster by role/domain keywords before deciding nobody fits.",
    "- `mcp__agentup__delegate_to_agent` — hand a bounded subtask to a recruited specialist (user approval required).",
    "- `mcp__agentup__check_delegation` — inspect prior task status/results.",
    "- `mcp__agentup__cancel_delegation` — stop a running or queued specialist task when the user asks to stop it. Do not kill OS processes.",
    "- `mcp__agentup__steer_delegation` — refine a running task without cancelling it.",
    "- `mcp__agentup__resolve_delegation_update` — dispose of each in-progress task this user turn (steer / keep / cancel / new_task).",
    "A # Relevant recruited agents block is a lexical hint only. If one is a better fit (or the user named one): ask the user who should do it, then call `mcp__agentup__delegate_to_agent`. Do not silently self-serve.",
    "If the user wants a specialist stopped: call `mcp__agentup__cancel_delegation` (or `resolve_delegation_update` with action=cancel). Do not use Bash kill / vendor team shutdown.",
    "Briefs: user wording + confirmed facts + the deliverable (format and filename) only. Summarize outcomes; do not redo specialist deliverables.",
    delegationBriefLocationRule("external"),
    "If those MCP tools are not listed this turn, do not invent them.",
  ].join("\n");
}

/**
 * 群执掌 MCP 协作契约：闭合房间，只许委派 `# Group members` 里的 agent_id。
 * 对齐 Pi `formatGroupCollaborationPrompt`，工具名一律 `mcp__agentup__*`。
 */
export function formatExternalGroupCollaborationPrompt(): string {
  return [
    "## AgentUp Group",
    "",
    "You are the current speaker in a group room, and you stay the speaker. Do only work that fits your own role.",
    "The only specialists you may delegate to are the other room members listed under # Group members.",
    "If one of them is a better fit, call `mcp__agentup__delegate_to_agent` with that **agent_id** (not the display name). Do not delegate outside the room, and do not delegate to yourself.",
    "If none of them fit, do the work yourself or ask the user. Do not call `mcp__agentup__agent_search` in a group room.",
    "When this turn's MCP lists AgentUp delegation tools, use these names:",
    "- `mcp__agentup__delegate_to_agent` — hand work to a room member by agent_id (always async in a group).",
    "- `mcp__agentup__check_delegation` — inspect prior task status/results.",
    "- `mcp__agentup__cancel_delegation` — stop a running or queued task when the user asks to stop it. Do not kill OS processes.",
    "- `mcp__agentup__steer_delegation` — refine a running task without cancelling it.",
    "- `mcp__agentup__resolve_delegation_update` — dispose of each in-progress task this user turn (steer / keep / cancel / new_task).",
    "Write each brief or steer note yourself for that member, including constraints already stated. Do not paste the whole user message to every person.",
    "Briefs: user wording + confirmed facts + the deliverable (format and filename) only — do not invent product/design defaults.",
    groupHandoffLocationRule("external"),
    "If the user mentions a member who already has a running task: `mcp__agentup__steer_delegation` or `mcp__agentup__resolve_delegation_update` (action=steer). Do not open a second task for them.",
    "On a user turn with in-progress delegations, call `mcp__agentup__resolve_delegation_update` once per task before you finish.",
    "If the user wants a specialist stopped: `mcp__agentup__cancel_delegation` (or resolve with action=cancel). Do not use Bash kill / vendor team shutdown.",
    "`mcp__agentup__delegate_to_agent` is always async in a group: it returns the task_id immediately. Finish your turn after delegating.",
    "If those MCP tools are not listed this turn, do not invent them.",
  ].join("\n");
}
/** 人设：第三方 Agent 在 `cwd/.pi/SYSTEM.md`，私人助理投影到 `<root>/.runtime/SYSTEM.md`。 */
export function readPersona(visit: Visit, cwd: string): string {
  const candidates =
    visit.kind === "personal"
      ? [path.join(visit.root, ".runtime", "SYSTEM.md"), path.join(cwd, ".pi", "SYSTEM.md")]
      : [path.join(cwd, ".pi", "SYSTEM.md")];
  for (const file of candidates) {
    const text = readTextFile(file);
    if (text.trim()) return text;
  }
  return "";
}

/** 工作规则：由 `projectVisitAgentsMd` 投影到 `<root>/.runtime/AGENTS.md`。 */
export function readAgentsMd(visitRoot: string): string {
  return readTextFile(path.join(visitRoot, ".runtime", "AGENTS.md"));
}

function readSkills(visit: Visit, userDataRoot?: string): InvocableSkill[] {
  try {
    return listVisitSkills(visit, userDataRoot);
  } catch {
    // 技能读不出来不该挡住整轮：没有清单它也能干活
    return [];
  }
}

function realOrSelf(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function readTextFile(file: string): string {
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return "";
    return fs.readFileSync(file, "utf8").slice(0, MAX_FILE_CHARS);
  } catch {
    return "";
  }
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…(truncated)`;
}
