/**
 * 列模型元数据：上下文窗口 / 输出上限。
 * 只认稳定正整数；勿把档位串（"300k"）或臆造值写进来。
 */

/** 正整数 token 数；非数字 / ≤0 → undefined。 */
export function positiveTokenCount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/** 拼可选窗口字段；有才写，勿塞 undefined。 */
export function withTokenLimits(base: {
  id: string;
  name: string;
  credits?: number;
  contextWindow?: number;
  maxTokens?: number;
}): {
  id: string;
  name: string;
  credits?: number;
  contextWindow?: number;
  maxTokens?: number;
} {
  const out: {
    id: string;
    name: string;
    credits?: number;
    contextWindow?: number;
    maxTokens?: number;
  } = { id: base.id, name: base.name };
  if (typeof base.credits === "number" && base.credits >= 0) out.credits = base.credits;
  if (typeof base.contextWindow === "number" && base.contextWindow > 0) {
    out.contextWindow = Math.floor(base.contextWindow);
  }
  if (typeof base.maxTokens === "number" && base.maxTokens > 0) {
    out.maxTokens = Math.floor(base.maxTokens);
  }
  return out;
}
