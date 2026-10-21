/**
 * 拼进 Pi appendSystemPrompt 的平台协作策略（仅父会话挂载委托工具时）。
 * 面向模型的英文说明；与 cwd 规范同级，不进用户 SYSTEM.md。
 */
export function formatCollaborationPrompt(): string {
  return [
    "# AgentUp Collaboration",
    "",
    "You can collaborate with specialists from the user's contact list: local private agents and market agents they recruited.",
    "Each specialist has a distinct name, role, and background — use them for more accurate results when the task fits their expertise.",
    "",
    "How to collaborate:",
    "- Relevant candidates may appear each turn as a \"Relevant recruited agents\" context block.",
    "- To search or list more, call list_recruited_agents (optional query over name / role / background). The list includes local agents.",
    "- Delegate a bounded subtask with delegate_to_agent; the user must approve the consultation.",
    "- You keep ownership of the user-facing reply: synthesize the specialist's result; do not dump it raw or hand off the conversation.",
    "",
    "Do not delegate trivial work that is clearly within your own role. Keep briefs minimal — only what the specialist needs.",
  ].join("\n");
}
