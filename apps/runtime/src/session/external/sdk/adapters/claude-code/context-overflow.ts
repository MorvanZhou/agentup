/**
 * Claude Code / Anthropic：Prompt is too long、Input is too long、Context limit reached 等。
 * 见 https://code.claude.com/docs/en/errors
 */
import { matchContextOverflowText } from "../../host/context-overflow.js";

export const CLAUDE_CODE_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /prompt is too long/i,
  /prompt.?too.?long/i,
  /input is too long/i,
  /input.?too.?long/i,
  /context limit reached/i,
  /context_length_exceeded/i,
  /maximum context length/i,
  /automatic compaction failed/i,
];

export function isClaudeCodeContextOverflowText(text: string): boolean {
  return matchContextOverflowText(text, CLAUDE_CODE_OVERFLOW_PATTERNS);
}
