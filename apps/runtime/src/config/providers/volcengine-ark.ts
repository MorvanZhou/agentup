/**
 * 对齐 npm `pi-provider-volcengine-ark@0.2.1` 的 registerProvider 载荷。
 * 该包仅发布 Extension 用的 index.ts，runtime 侧以 TypeScript 内嵌以便编译进安装包。
 * @see https://www.npmjs.com/package/pi-provider-volcengine-ark
 */

const BASE_COMPAT = {
  supportsDeveloperRole: false,
  supportsStore: false,
  supportsStrictMode: false,
  maxTokensField: "max_tokens" as const,
};

const HIGH_ONLY = {
  off: null,
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  xhigh: null,
  max: null,
} as const;

const GLM53_EFFORT = {
  off: "low",
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "max",
  max: "max",
} as const;

export const VOLCENGINE_ARK_PROVIDER_ID = "volcengine-ark";

export const volcengineArkProviderConfig = {
  id: VOLCENGINE_ARK_PROVIDER_ID,
  name: "Volcengine Ark",
  baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
  api: "openai-completions" as const,
  models: [
    {
      id: "glm-5.3",
      name: "GLM-5.3",
      reasoning: true,
      input: ["text"] as Array<"text" | "image">,
      cost: { input: 1.1, output: 3.851, cacheRead: 0.275, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      thinkingLevelMap: GLM53_EFFORT,
      compat: { ...BASE_COMPAT, supportsReasoningEffort: true },
    },
    {
      id: "glm-5.2",
      name: "GLM-5.2",
      reasoning: true,
      input: ["text"] as Array<"text" | "image">,
      cost: { input: 1.1, output: 3.851, cacheRead: 0.275, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      thinkingLevelMap: HIGH_ONLY,
      compat: { ...BASE_COMPAT, supportsReasoningEffort: false },
    },
    {
      id: "kimi-k2.7-code",
      name: "Kimi K2.7 Code",
      reasoning: true,
      input: ["text", "image"] as Array<"text" | "image">,
      cost: { input: 0.73, output: 3.5, cacheRead: 0.15, cacheWrite: 0 },
      contextWindow: 262_144,
      maxTokens: 32_768,
      thinkingLevelMap: HIGH_ONLY,
      compat: { ...BASE_COMPAT, thinkingFormat: "qwen", supportsReasoningEffort: false },
    },
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      reasoning: true,
      input: ["text"] as Array<"text" | "image">,
      cost: { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 393_216,
      thinkingLevelMap: HIGH_ONLY,
      compat: { ...BASE_COMPAT, thinkingFormat: "deepseek", supportsReasoningEffort: true },
    },
    {
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      reasoning: true,
      input: ["text"] as Array<"text" | "image">,
      cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 393_216,
      thinkingLevelMap: HIGH_ONLY,
      compat: { ...BASE_COMPAT, thinkingFormat: "deepseek", supportsReasoningEffort: true },
    },
    {
      id: "minimax-m3",
      name: "MiniMax-M3",
      reasoning: true,
      input: ["text", "image"] as Array<"text" | "image">,
      cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      contextWindow: 512_000,
      maxTokens: 131_072,
      thinkingLevelMap: HIGH_ONLY,
      compat: { ...BASE_COMPAT, supportsReasoningEffort: false },
    },
    {
      id: "minimax-m2.7",
      name: "MiniMax-M2.7",
      reasoning: true,
      input: ["text"] as Array<"text" | "image">,
      cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 },
      contextWindow: 204_800,
      maxTokens: 131_072,
      thinkingLevelMap: HIGH_ONLY,
      compat: { ...BASE_COMPAT, supportsReasoningEffort: false },
    },
    {
      id: "kimi-k2.6",
      name: "Kimi K2.6",
      reasoning: true,
      input: ["text", "image"] as Array<"text" | "image">,
      cost: { input: 0.929, output: 3.858, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 262_144,
      maxTokens: 32_768,
      thinkingLevelMap: HIGH_ONLY,
      compat: { ...BASE_COMPAT, thinkingFormat: "qwen", supportsReasoningEffort: false },
    },
  ],
};

export function volcengineArkRegisterConfig(apiKey: string) {
  return {
    name: volcengineArkProviderConfig.name,
    baseUrl: volcengineArkProviderConfig.baseUrl,
    apiKey,
    api: volcengineArkProviderConfig.api,
    models: volcengineArkProviderConfig.models.map((model) => ({ ...model })),
  };
}
