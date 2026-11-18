/**
 * OpenCode：多透传上游文案（Anthropic / OpenAI / Gemini / Bedrock 等）。
 * 覆盖常见 ContextOverflowError 原文。
 */
import { matchContextOverflowText } from "../../host/context-overflow.js";

export const OPENCODE_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /prompt is too long/i,
  /prompt.?too.?long/i,
  /input is too long/i,
  /exceeds the context window/i,
  /input exceeds the context window/i,
  /input token count exceeds/i,
  /maximum context length/i,
  /maximum prompt length/i,
  /context length exceeded/i,
  /context_length_exceeded/i,
  /exceeds the available context/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /reduce the length of the messages/i,
];

export function isOpencodeContextOverflowText(text: string): boolean {
  return matchContextOverflowText(text, OPENCODE_OVERFLOW_PATTERNS);
}
