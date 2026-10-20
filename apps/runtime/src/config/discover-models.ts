import { ConfigError } from "./load.js";
import type { ProviderTemplateKind } from "./provider-templates.js";

const MAX_MODELS = 200;
const FETCH_TIMEOUT_MS = 15_000;

/** 可通过 OpenAI 兼容 `/models`（或 Ollama `/api/tags`）拉候选模型。 */
export function supportsModelDiscovery(kind: ProviderTemplateKind): boolean {
  return kind === "ollama" || kind === "custom-openai" || kind === "volcengine-ark";
}

export async function discoverRemoteModels(input: {
  baseUrl: string;
  apiKey?: string;
  kind: ProviderTemplateKind;
}): Promise<string[]> {
  const base = input.baseUrl.replace(/\/+$/, "");
  if (!base) throw new ConfigError("服务地址无效");

  const headers: Record<string, string> = { Accept: "application/json" };
  const key = input.apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  let openAiError: unknown;
  try {
    const ids = await fetchOpenAiModels(`${base}/models`, headers);
    if (ids.length > 0) return ids;
  } catch (error) {
    openAiError = error;
  }

  if (input.kind === "ollama") {
    try {
      const origin = base.replace(/\/v1$/i, "");
      const ids = await fetchOllamaTags(`${origin}/api/tags`);
      if (ids.length > 0) return ids;
    } catch (error) {
      if (!openAiError) openAiError = error;
    }
  }

  if (openAiError instanceof ConfigError) throw openAiError;
  throw new ConfigError("无法获取模型列表，请检查服务地址与密钥");
}

async function fetchOpenAiModels(url: string, headers: Record<string, string>): Promise<string[]> {
  const payload = await fetchJson(url, headers);
  const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload) ? payload : null;
  if (!rows) throw new ConfigError("模型列表响应无效");
  return normalizeIds(
    rows.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return "";
      const id = (row as Record<string, unknown>).id;
      return typeof id === "string" ? id : "";
    }),
  );
}

async function fetchOllamaTags(url: string): Promise<string[]> {
  const payload = await fetchJson(url, { Accept: "application/json" });
  const rows = Array.isArray(payload.models) ? payload.models : null;
  if (!rows) throw new ConfigError("模型列表响应无效");
  return normalizeIds(
    rows.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return "";
      const name = (row as Record<string, unknown>).name;
      return typeof name === "string" ? name : "";
    }),
  );
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ConfigError(`获取模型列表失败（HTTP ${response.status}）`);
    }
    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      // OpenAI 偶发直接返回数组
      if (Array.isArray(payload)) return { data: payload };
      throw new ConfigError("模型列表响应无效");
    }
    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ConfigError("获取模型列表超时");
    }
    throw new ConfigError("无法连接服务商以获取模型列表");
  } finally {
    clearTimeout(timer);
  }
}

function normalizeIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || id.length > 200 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}
