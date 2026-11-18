/**
 * GitHub Copilot：prompt budget / reserving output 超限文案。
 */
import { matchContextOverflowText } from "../../host/context-overflow.js";

export const COPILOT_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /prompt budget/i,
  /reserving output/i,
  /reduce context or compact/i,
];

export function isCopilotContextOverflowText(text: string): boolean {
  return matchContextOverflowText(text, COPILOT_OVERFLOW_PATTERNS);
}
