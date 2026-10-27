import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** 每次模型请求都带上的采样默认值。不按供应商是否声明支持来省略。 */
export const DEFAULT_TEMPERATURE = 1;
export const DEFAULT_TOP_P = 0.95;

/**
 * 把默认采样写进即将发出的 provider payload。
 * 字段名跟各适配器的请求体走：多数接口是顶层 `temperature` / `top_p`；
 * Google / Vertex 在 `config`，Bedrock 在 `inferenceConfig`，pi-messages 在 `options`。
 */
export function applyDefaultSampling(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const body = payload as Record<string, unknown>;

  if (isPlainObject(body.config) && "contents" in body) {
    return {
      ...body,
      config: { ...body.config, temperature: DEFAULT_TEMPERATURE, topP: DEFAULT_TOP_P },
    };
  }

  if (isPlainObject(body.inferenceConfig) && "modelId" in body) {
    return {
      ...body,
      inferenceConfig: {
        ...body.inferenceConfig,
        temperature: DEFAULT_TEMPERATURE,
        topP: DEFAULT_TOP_P,
      },
    };
  }

  if (isPlainObject(body.options) && "context" in body && !("messages" in body)) {
    return {
      ...body,
      options: { ...body.options, temperature: DEFAULT_TEMPERATURE, top_p: DEFAULT_TOP_P },
    };
  }

  return { ...body, temperature: DEFAULT_TEMPERATURE, top_p: DEFAULT_TOP_P };
}

/** 挂到 `createAgentSession`：在 `before_provider_request` 盖上默认采样。 */
export function createDefaultSamplingExtension(): ExtensionFactory {
  return (pi) => {
    pi.on("before_provider_request", (event) => applyDefaultSampling(event.payload));
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
