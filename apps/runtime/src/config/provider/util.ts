import { ConfigError } from "../load.js";
import { toOpenAiCompatRoot } from "../openai-compat-url.js";
import type { ModelRef, ProviderConnection } from "./types.js";

export { allowsMultipleConnections } from "../discover-models.js";
export { toOpenAiCompatRoot } from "../openai-compat-url.js";

export function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

/** 模型所属连接主键；旧 ref 无 connectionId 时回落 templateId。 */
export function connectionIdOf(ref: Pick<ModelRef, "templateId" | "connectionId">): string {
  return clean(ref.connectionId) || clean(ref.templateId);
}

/** 模型在全局的唯一键，用于 enabled / active 比对。 */
export function modelKey(ref: ModelRef): string {
  return `${connectionIdOf(ref)}::${ref.modelId}`;
}

/** 按 connectionId 找连接；旧数据 connectionId===templateId。 */
export function findConnection(
  connections: ProviderConnection[],
  connectionId: string,
): ProviderConnection | undefined {
  const id = clean(connectionId);
  if (!id) return undefined;
  return connections.find((item) => item.connectionId === id);
}

/** 只收 http(s) 且不带凭据的地址；剥掉 completions/models 后缀后落盘。 */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) throw new ConfigError("服务地址无效");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ConfigError("服务地址无效");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new ConfigError("服务地址无效");
  }
  const root = toOpenAiCompatRoot(trimmed);
  if (!root) throw new ConfigError("服务地址无效");
  try {
    // 剥后缀后仍须是合法 URL（例如误填成相对路径）
    new URL(root);
  } catch {
    throw new ConfigError("服务地址无效");
  }
  return root;
}
