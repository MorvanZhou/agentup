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
    "Collaborate with specialists from the user's contact list (local + recruited) when their role/background fits.",
    "Relevant candidates may appear each turn; use list_recruited_agents to search or list more.",
    "Delegate with delegate_to_agent (user must approve). You own the user-facing reply — synthesize, don't dump or hand off.",
    "",
    "wait=true (default for one short task): need the answer this turn. wait=false: long/parallel work; return task_id, then check_delegation or wait for a session notice — never invent results. cancel_delegation(task_id) stops a running async task.",
    "Fan-out: prefer one call with tasks=[{agent_id, brief}, ...] (≤8, default async); or multiple wait=false calls. Briefs minimal and non-overlapping; skip trivial work you can do yourself.",
    `Non-specialist long shell work: bg_run(command) (async, needs approval like \`${commandTool}\`); bg_status / bg_kill. Prefer delegate_to_agent when expertise matters.`,
  ].join("\n");
}
