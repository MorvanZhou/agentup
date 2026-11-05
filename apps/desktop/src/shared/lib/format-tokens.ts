/** 模型上下文窗口展示：1000000 → 1M，200000 → 200k。 */
export function formatTokenWindow(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "";
  const n = Math.floor(tokens);
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}M`;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}k`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
