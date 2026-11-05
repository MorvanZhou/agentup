/** 受限压缩回合的系统 / 前缀文案（各 adaptor 共用，勿叠业务 Environment）。 */
export const COMPACT_SYSTEM_PROMPT =
  "你是会话压缩器。只输出一段结构化中文摘要，不要调用工具，不要提问，不要开场白。";

/** 无 systemPrompt replace 的厂商：把压缩指令叠进 user prompt。 */
export function compactUserPrompt(transcriptPrompt: string): string {
  return `${COMPACT_SYSTEM_PROMPT}\n\n---\n\n${transcriptPrompt}`;
}
