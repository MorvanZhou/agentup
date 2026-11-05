import { ConfigError } from "../load.js";

/**
 * 模型目录统一契约（API 发现 + 本地 Agent SDK）：
 *
 * - 能拉到非空活目录 → 写入 / 返回
 * - 拉失败或空列表 → **禁止**用假 FALLBACK 目录冒充「已发现」
 * - 对外同一句提示：重新拉取，或手动配置
 *
 * 例外：厂商公开 SDK **根本没有** list API、且文档约定 curated 白名单时，
 * 可在 adaptor 内写明「curated 非失败回落」并返回该白名单（如 dsh）。
 * 一旦走了活拉取路径，空/失败必须走本文件，不得静默塞别名。
 */

/** 稳定文案；Desktop toast / ConfigError / 测例共用。 */
export const MODEL_CATALOG_UNAVAILABLE =
  "暂时无法获取可用模型列表，请重新拉取，或手动配置";

export function modelCatalogUnavailableError(): ConfigError {
  return new ConfigError(MODEL_CATALOG_UNAVAILABLE);
}

export function throwModelCatalogUnavailable(): never {
  throw modelCatalogUnavailableError();
}

/** 活目录必须非空；空 → 统一错误（禁 FALLBACK）。 */
export function requireNonEmptyModelCatalog<T>(models: readonly T[]): T[] {
  if (models.length === 0) throwModelCatalogUnavailable();
  return [...models];
}
