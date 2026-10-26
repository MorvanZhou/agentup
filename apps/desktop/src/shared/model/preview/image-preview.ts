export const IMAGE_PREVIEW_MIN_SCALE = 0.25;
export const IMAGE_PREVIEW_MAX_SCALE = 5;
export const IMAGE_PREVIEW_SCALE_STEP = 0.25;

export function clampPreviewScale(scale: number): number {
  return Math.min(IMAGE_PREVIEW_MAX_SCALE, Math.max(IMAGE_PREVIEW_MIN_SCALE, scale));
}

/** 按固定步进放大 / 缩小。 */
export function nextPreviewScale(scale: number, direction: 1 | -1): number {
  const next = scale + direction * IMAGE_PREVIEW_SCALE_STEP;
  return clampPreviewScale(Math.round(next * 100) / 100);
}

/** 滚轮：向下缩小、向上放大。 */
export function wheelPreviewScale(scale: number, deltaY: number): number {
  if (deltaY === 0) return clampPreviewScale(scale);
  return nextPreviewScale(scale, deltaY > 0 ? -1 : 1);
}

export function formatPreviewScale(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
