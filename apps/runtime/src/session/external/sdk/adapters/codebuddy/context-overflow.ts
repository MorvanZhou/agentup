/**
 * CodeBuddy：与后端同源——Claude 系 prompt too long；OpenAI 兼容 exceeds context window。
 */
import { matchContextOverflowText } from "../../host/context-overflow.js";

export const CODEBUDDY_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /prompt is too long/i,
  /prompt.?too.?long/i,
  /input is too long/i,
  /input exceeds the context window/i,
  /exceeds the context window/i,
  /context_length_exceeded/i,
  /maximum context length/i,
  /token limit exceeded/i,
];

export function isCodebuddyContextOverflowText(text: string): boolean {
  return matchContextOverflowText(text, CODEBUDDY_OVERFLOW_PATTERNS);
}
