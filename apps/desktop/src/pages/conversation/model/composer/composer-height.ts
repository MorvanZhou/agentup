import { clampPaneWidth } from "../layout/pane-width";

/** 与原先 min-h-16 / 约 3 行 text-sm 对齐。 */
export const COMPOSER_INPUT_DEFAULT_HEIGHT = 72;
export const COMPOSER_INPUT_MIN_HEIGHT = 64;

const COMPOSER_INPUT_KEY = "agentup.conversation.composerInputHeight";

export function clampComposerInputHeight(height: number, min: number, max: number): number {
  return clampPaneWidth(height, min, max);
}

/** 输入区最高约占线程主列一半，且不低于最小值。 */
export function maxComposerInputHeight(threadHeight: number): number {
  return Math.max(COMPOSER_INPUT_MIN_HEIGHT, Math.floor(threadHeight * 0.5));
}

export function loadComposerInputHeight(): number {
  const raw = localStorage.getItem(COMPOSER_INPUT_KEY);
  if (!raw) return COMPOSER_INPUT_DEFAULT_HEIGHT;
  const value = Number(raw);
  if (!Number.isFinite(value)) return COMPOSER_INPUT_DEFAULT_HEIGHT;
  return clampComposerInputHeight(value, COMPOSER_INPUT_MIN_HEIGHT, Number.POSITIVE_INFINITY);
}

export function rememberComposerInputHeight(height: number): void {
  localStorage.setItem(COMPOSER_INPUT_KEY, String(height));
}
