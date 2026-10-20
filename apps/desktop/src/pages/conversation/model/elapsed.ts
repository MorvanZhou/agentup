/** 将毫秒耗时格式化为短标签（与工具卡片一致）。 */
export function formatElapsedMs(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 1000) return "<1s";
  const seconds = safe / 1000;
  if (seconds < 10) return `${(Math.floor(seconds * 10) / 10).toFixed(1)}s`;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}
