/** 新对话等导致线程整树重建时，暂存 Composer 未发送正文。 */
const drafts = new Map<string, string>();

export function rememberComposerDraft(agentId: string, text: string): void {
  if (!agentId) return;
  drafts.set(agentId, text);
}

/** 取出并清除；无草稿时返回 undefined。 */
export function takeComposerDraft(agentId: string): string | undefined {
  if (!agentId || !drafts.has(agentId)) return undefined;
  const text = drafts.get(agentId);
  drafts.delete(agentId);
  return text;
}

/** 解雇或离队时丢掉残留草稿。 */
export function forgetComposerDraft(agentId: string): void {
  if (!agentId) return;
  drafts.delete(agentId);
}
