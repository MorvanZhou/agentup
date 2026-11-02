import { ConfigError } from "../load.js";
import type { ModelRef } from "./types.js";

export function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

/** 模型在全局的唯一键，用于 enabled / active 比对。 */
export function modelKey(ref: ModelRef): string {
  return `${ref.templateId}::${ref.modelId}`;
}

/** 只收 http(s) 且不带凭据的地址，去掉末尾斜杠。 */
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
  return trimmed.replace(/\/+$/, "");
}
