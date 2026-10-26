import {
  detectHostEnvironment,
  type CommandToolName,
} from "../environment.js";

/**
 * 拼进 Pi appendSystemPrompt 的平台协作契约（仅挂载委托工具的父会话）。
 * 面向模型的英文说明；与 cwd 规范同级，不进用户 SYSTEM.md / profile。
 *
 * 通用契约：只做本职；更合适的 agent 去完成；调用方当协调者。
 */
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
    "Briefs: user wording + confirmed facts + delivery constraints only — do not invent product/design defaults. Summarize outcomes; do not redo specialist deliverables.",
    "On cancel/failure: re-delegate or ask the user. Never take over the specialist's work unless they say so, or no suitable recruit exists.",
    "",
    "Before delegate_to_agent: if \"# Active delegations\" appears (or you started async work), check_delegation first. Do not re-delegate the same specialist for an overlapping brief while running/pending_auth.",
    "wait=true only if likely ≤ ~20s and you need the answer this turn; else wait=false (task_id; never invent results). Do not default to sync for a single specialist. cancel_delegation(task_id) stops async work.",
    "Fan-out: tasks=[{agent_id, brief}, ...] (≤8, async unless wait=true). Briefs minimal and non-overlapping.",
    `Shell: short ${commandTool} OK for work inside your role; >~20s → bg_run (approval like \`${commandTool}\`), then bg_status / bg_kill. Prefer delegate_to_agent when another agent's expertise fits better.`,
  ].join("\n");
}
