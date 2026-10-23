import {
  detectHostEnvironment,
  type CommandToolName,
} from "../environment.js";

/**
 * 拼进 Pi appendSystemPrompt 的平台协作策略（仅父会话挂载委托工具时）。
 * 面向模型的英文说明；与 cwd 规范同级，不进用户 SYSTEM.md。
 */
export function formatCollaborationPrompt(
  commandTool: CommandToolName = detectHostEnvironment().commandTool,
): string {
  return [
    "# AgentUp Collaboration",
    "",
    "You are in a collaboration workspace with the user's specialist contact list (local private + market recruited).",
    "When a task may benefit from another agent's role or background, call agent_search with a short query before answering alone or guessing who to involve.",
    "Relevant candidates may also appear for the current turn; refine with agent_search when needed, then delegate_to_agent (user must approve).",
    "You own the user-facing reply — synthesize results; do not dump or hand off the conversation.",
    "",
    "Before delegate_to_agent, estimate how long the specialist needs (skills, shell, network). " +
      "If likely ≤ ~20s and you need the answer this turn → wait=true. " +
      "If likely > ~20s, uncertain/long, or you can continue other work → wait=false (return task_id; check_delegation or wait for a session notice — never invent results). " +
      "cancel_delegation(task_id) stops a running async task. Do not default to sync just because there is only one specialist.",
    "Fan-out: prefer one call with tasks=[{agent_id, brief}, ...] (≤8, async unless you set wait=true to join this turn); or multiple wait=false calls. Briefs minimal and non-overlapping; skip trivial work you can do yourself.",
    `Shell: same duration rule — short ${commandTool} OK; if a command may run > ~20s (build, watch, migrate, heavy script), prefer bg_run (approval like \`${commandTool}\`), then bg_status / bg_kill. Prefer delegate_to_agent when expertise matters.`,
  ].join("\n");
}
