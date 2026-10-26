/** 私人助理在这些工具之前必须先 agent_search。专家直聊不拦。 */
export const TOOLS_REQUIRING_AGENT_SEARCH = new Set([
  "ask_user",
  "write",
  "edit",
  "bash",
  "powershell",
  "bg_run",
]);

export function agentSearchGate(input: {
  toolName: string;
  /** 仅私人助理为 true。 */
  enforce: boolean;
  hasOtherAgents: boolean;
  searched: boolean;
}): { block: true; reason: string } | undefined {
  if (!input.enforce || input.searched || !input.hasOtherAgents) return undefined;
  if (!TOOLS_REQUIRING_AGENT_SEARCH.has(input.toolName)) return undefined;
  return {
    block: true,
    reason:
      "Call agent_search first with role or domain keywords. " +
      "A # Relevant recruited agents hint is not a search; a poor match does not mean the roster has no one. " +
      "Then ask the user who should do the work.",
  };
}
