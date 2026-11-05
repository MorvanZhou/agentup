import type { ExternalModel } from "../../contract.js";
import { positiveTokenCount, withTokenLimits } from "../../host/model-meta.js";

/**
 * Anthropic Models API → ExternalModel。
 * Console API Key 登录后写入活目录；空/失败走 MODEL_CATALOG_UNAVAILABLE，禁假目录。
 *
 * 请求形态对齐官方 curl（勿多加 lifecycle 过滤）：省略 lifecycle 时 API 默认
 * 返回 active + deprecated，与「只要现行」一致；多传 lifecycle 在部分 Key/版本上会 400，
 * 而本机 curl 无该参数却能成功 → 设置页误报「无法获取模型列表」。
 * @see https://docs.anthropic.com/en/api/models-list
 */

const MODELS_URL = "https://api.anthropic.com/v1/models";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_MODELS = 200;
const PAGE_LIMIT = 100;

/** 测例钉死：与可成功的 curl 同形（仅 limit / after_id）。 */
export function anthropicModelsListUrl(afterId?: string): string {
  const url = new URL(MODELS_URL);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  if (afterId) url.searchParams.set("after_id", afterId);
  return url.toString();
}

export async function listAnthropicModelsViaApi(
  apiKey: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ExternalModel[]> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const out: ExternalModel[] = [];
    let afterId: string | undefined;
    while (out.length < MAX_MODELS) {
      const page = await fetchModelsPage(apiKey, afterId, controller.signal);
      for (const row of page.models) {
        out.push(row);
        if (out.length >= MAX_MODELS) break;
      }
      if (!page.hasMore || !page.lastId) break;
      afterId = page.lastId;
    }
    return out;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

async function fetchModelsPage(
  apiKey: string,
  afterId: string | undefined,
  signal: AbortSignal,
): Promise<{ models: ExternalModel[]; hasMore: boolean; lastId?: string }> {
  const response = await fetch(anthropicModelsListUrl(afterId), {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Anthropic models API ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }
  const body = (await response.json()) as {
    data?: unknown;
    has_more?: unknown;
    last_id?: unknown;
  };
  const models = normalizeAnthropicModels(body.data);
  return {
    models,
    hasMore: body.has_more === true,
    lastId: typeof body.last_id === "string" && body.last_id ? body.last_id : undefined,
  };
}

/** 测例 / lifecycle 共用：把 API data[] 归一成 ExternalModel。 */
export function normalizeAnthropicModels(raw: unknown): ExternalModel[] {
  if (!Array.isArray(raw)) return [];
  const out: ExternalModel[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    // retired 即使误入也跳过
    if (row.lifecycle === "retired") continue;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // 展示名用 display_name；完整 id 由设置页次行 tag 后展示，勿塞进 name 挤布局
    const name =
      typeof row.display_name === "string" && row.display_name.trim()
        ? row.display_name.trim()
        : id;
    // Models API：max_input_tokens = 上下文；max_tokens = 输出上限
    const contextWindow = positiveTokenCount(row.max_input_tokens);
    const maxTokens = positiveTokenCount(row.max_tokens);
    out.push(
      withTokenLimits({
        id,
        name,
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
      }),
    );
  }
  return out;
}
