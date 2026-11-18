/**
 * DSH：未见独立超限文案；回落通用 OpenAI/Anthropic 短句，便于后端透传时归一。
 */
import { matchContextOverflowText } from "../../host/context-overflow.js";

export const DSH_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /prompt is too long/i,
  /input is too long/i,
  /exceeds the context window/i,
  /context_length_exceeded/i,
  /maximum context length/i,
];

export function isDshContextOverflowText(text: string): boolean {
  return matchContextOverflowText(text, DSH_OVERFLOW_PATTERNS);
}
