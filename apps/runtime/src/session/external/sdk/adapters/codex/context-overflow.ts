/**
 * Codex / OpenAI：ran out of room、input exceeds the context window、context_length_exceeded。
 */
import { matchContextOverflowText } from "../../host/context-overflow.js";

export const CODEX_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /ran out of room/i,
  /input exceeds the context window/i,
  /exceeds the context window/i,
  /context_length_exceeded/i,
  /maximum context length/i,
];

export function isCodexContextOverflowText(text: string): boolean {
  return matchContextOverflowText(text, CODEX_OVERFLOW_PATTERNS);
}
