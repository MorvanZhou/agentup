/**
 * Cursor：context length/window、prompt too long、Conversation Too Long 等。
 * 勿把 rate limit / resource_exhausted 当超限（易与限流混淆）。
 */
import { matchContextOverflowText } from "../../host/context-overflow.js";

export const CURSOR_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /context[_ ]?length/i,
  /context[_ ]?window/i,
  /maximum context/i,
  /prompt is too long/i,
  /too large for model/i,
  /conversation too long/i,
  /exceed(?:s|ed).{0,30}context/i,
];

const CURSOR_THROTTLE_PATTERN = /too many requests|rate.?limit|throttl|retry.?after/i;

export function isCursorContextOverflowText(text: string): boolean {
  const raw = (text ?? "").trim();
  if (CURSOR_THROTTLE_PATTERN.test(raw)) return false;
  return matchContextOverflowText(raw, CURSOR_OVERFLOW_PATTERNS);
}
