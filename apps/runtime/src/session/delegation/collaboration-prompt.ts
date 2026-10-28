import {
  detectHostEnvironment,
  type CommandToolName,
} from "../environment.js";
import { formatAgentCardLine } from "./discover.js";
import type { RecruitedAgentInfo } from "./types.js";

/**
 * 拼进 Pi appendSystemPrompt 的平台协作契约（仅挂载委托工具的父会话）。
 * 面向模型的英文说明；与 cwd 规范同级，不进用户 SYSTEM.md / profile。
 *
 * 通用契约：只做本职；更合适的 agent 去完成；调用方当协调者。
 * 成品位置：专员只写自己的 ARTIFACT/，由 deliver_artifacts 投递，brief 不写绝对路径。
 */
export const DELEGATION_BRIEF_LOCATION_RULE =
  "The specialist writes finished files only in their own ARTIFACT/ and confirms them with deliver_artifacts; the platform copies those into your ARTIFACT/. " +
  "Do not put absolute paths, your cwd, another agent's directory, or ARTIFACT/from- into the brief or a steer note, and do not ask them to copy files into your workspace.";

/** 群内交接走共享工作区，不把专员的私有 ARTIFACT 复制回执掌者。 */
export const GROUP_HANDOFF_LOCATION_RULE =
  "Shared work goes in the group workspace under WORK/from-<name>-<task_id>/ and ARTIFACT/from-<name>-<task_id>/ " +
  "(same folder shape as one-to-one delivery; the trailing id is this task_id, not the agent id). " +
  "Name those relative paths in the brief or a steer note. Do not put absolute paths, your private cwd, or another agent's private directory there. " +
  "The specialist writes those shared paths directly and confirms them with complete_group_task, including the next step. " +
  "Do not ask them to copy files into your private ARTIFACT/.";

export function formatCollaborationPrompt(
  commandTool: CommandToolName = detectHostEnvironment().commandTool,
): string {
  return [
    "# AgentUp Collaboration",
    "",
    "Do only work that fits your own role. If another recruited agent is a better fit, call them and coordinate — do not do their job.",
    "Call agent_search (role or domain keywords) before ask_user, file writes, or shell, and before deciding no specialist fits.",
    "A # Relevant recruited agents block is a lexical hint, not a search. A poor hint does not mean the roster is empty.",
    "If a specialist matches (or the user named one): ask the user who should do it, then delegate_to_agent (tool approval required). Do not silently self-serve or pick an agent.",
    "Briefs: user wording + confirmed facts + the deliverable (format and filename) only — do not invent product/design defaults. Summarize outcomes; do not redo specialist deliverables.",
    DELEGATION_BRIEF_LOCATION_RULE,
    "On cancel/failure: re-delegate or ask the user. Never take over the specialist's work unless they say so, or no suitable recruit exists.",
    "",
    "Before delegate_to_agent: if \"# Active delegations\" appears (or you started async work), check_delegation first. Do not re-delegate the same specialist for an overlapping brief while running/pending_auth.",
    "If the user refines that same running task (narrower scope, simpler method, extra constraint): steer_delegation(task_id, note) or resolve_delegation_update(action=steer). The specialist keeps the current run and applies the note after the current step. Do not cancel_delegation just to re-delegate the same work.",
    "On a user turn with in-progress delegations, call resolve_delegation_update once per task before you finish (steer, keep, cancel, or new_task). Saying you passed the change on does not count. check_delegation does not count.",
    "cancel_delegation(task_id) only when the user wants that work stopped. Re-delegate when the task already finished, steer_delegation cannot insert, or the new work is a different task.",
    "wait=true only if likely ≤ ~20s and you need the answer this turn; else wait=false (task_id; never invent results). Do not default to sync for a single specialist.",
    "Fan-out: tasks=[{agent_id, brief}, ...] (≤8, async unless wait=true). Briefs minimal and non-overlapping.",
    `Shell: short ${commandTool} OK for work inside your role; >~20s → bg_run (approval like \`${commandTool}\`), then bg_status / bg_kill. Prefer delegate_to_agent when another agent's expertise fits better.`,
  ].join("\n");
}

/**
 * 群执掌者的协作契约。房间是闭合的，不检索、不扇出。
 */
export function formatGroupCollaborationPrompt(
  commandTool: CommandToolName = detectHostEnvironment().commandTool,
): string {
  return [
    "# AgentUp Group",
    "",
    "You are the current speaker in a group room, and you stay the speaker. Do only work that fits your own role.",
    "The only specialists you may delegate to are the other room members listed under # Group members.",
    "If one of them is a better fit, call delegate_to_agent with that agent_id (tool approval required). Do not delegate outside the room, and do not delegate to yourself.",
    "If none of them fit, do the work yourself or ask the user.",
    "You may keep several async tasks open at once, for different members. Do not hand the floor to another member.",
    "Write each brief or steer note yourself for that member, including constraints already stated. Do not paste the whole user message to every person.",
    "Briefs: user wording + confirmed facts + the deliverable (format and filename) only — do not invent product/design defaults.",
    GROUP_HANDOFF_LOCATION_RULE,
    "If the user mentions a member who already has a running task: steer_delegation(task_id, note) or resolve_delegation_update(action=steer). Do not open a second task for them, and do not cancel_delegation just to re-delegate the same work.",
    "If that task has not started, delegate_to_agent again with the revised brief. The room updates that same task.",
    "If a task is waiting on the user, leave it. Do not steer it, and do not treat the group message as the answer to that question or approval.",
    "On a user turn with in-progress delegations, call resolve_delegation_update once per task before you finish. Mentioned running tasks: steer. Tasks the user did not mention: keep. cancel only when the user wants that task stopped.",
    "delegate_to_agent is always async in a group: it returns the task_id immediately. Finish your turn after delegating; the room wakes you with the result when the specialist hands it back.",
    `Shell: short ${commandTool} OK for work inside your role. Prefer delegate_to_agent when another room member's expertise fits better.`,
  ].join("\n");
}

/** 除执掌者自己以外的群成员名片。没有招募名片时只留名字。 */
export function formatGroupRosterPrompt(input: {
  selfAgentId: string;
  members: readonly { agentId: string; name: string }[];
  cards: readonly RecruitedAgentInfo[];
}): string {
  const lines = input.members
    .filter((member) => member.agentId !== input.selfAgentId)
    .map((member) => {
      const card = input.cards.find((item) => item.agentId === member.agentId);
      if (!card) {
        const name = member.name.trim() || member.agentId;
        return `- ${name} (agent_id: ${member.agentId})`;
      }
      return formatAgentCardLine(card);
    });
  return [
    "# Group members",
    "",
    "These are the only other people in this room. delegate_to_agent may use only these agent_ids.",
    "",
    ...(lines.length > 0 ? lines : ["(No other members.)"]),
  ].join("\n");
}
