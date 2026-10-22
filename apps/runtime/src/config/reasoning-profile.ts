/**
 * 行业惯例：应用层统一 thinking 档位，模型层用 profile 翻译成各家 API 字段。
 * Pi 侧靠 model.reasoning + thinkingLevelMap + compat.supportsReasoningEffort / thinkingFormat。
 *
 * @see apps/runtime/src/config/providers/volcengine-ark.ts（内置供应商已按此配）
 */

export type ThinkingFormat =
  | "openai"
  | "openrouter"
  | "deepseek"
  | "together"
  | "baseten"
  | "zai"
  | "qwen"
  | "chat-template"
  | "qwen-chat-template"
  | "string-thinking"
  | "ant-ling";

/** 与 Pi `ThinkingLevelMap` 对齐：档位 → 厂商枚举；`null` 表示该档不可用。 */
export type ThinkingLevelMap = {
  off?: string | null;
  minimal?: string | null;
  low?: string | null;
  medium?: string | null;
  high?: string | null;
  xhigh?: string | null;
  max?: string | null;
};

export type ReasoningProfile = {
  reasoning: boolean;
  supportsReasoningEffort: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  thinkingFormat?: ThinkingFormat;
};

/** 无推理能力 / 未知模型：不发 reasoning 参数（保持旧行为）。 */
export const NO_REASONING_PROFILE: ReasoningProfile = {
  reasoning: false,
  supportsReasoningEffort: false,
};

/** OpenAI 风 effort 梯队（含可关闭）。 */
const OPENAI_EFFORT: ThinkingLevelMap = {
  off: "none",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/**
 * 混元 Hy4：服务端默认 high；官方 chat_template 只接受 `high` | `no_think`。
 * @see https://huggingface.co/tencent/Hy4-preview
 */
const HY4_EFFORT: ThinkingLevelMap = {
  off: "no_think",
  minimal: "no_think",
  low: "no_think",
  medium: "high",
  high: "high",
  xhigh: "high",
  max: "high",
};

/** DeepSeek：关思考走 thinking.type=disabled（需 off !== null）；强度用 effort。 */
const DEEPSEEK_EFFORT: ThinkingLevelMap = {
  off: "none",
  minimal: "low",
  low: "low",
  medium: "high",
  high: "high",
  xhigh: "max",
  max: "max",
};

/** Qwen：主要靠 enable_thinking=!!effort；effort 可选。 */
const QWEN_EFFORT: ThinkingLevelMap = {
  off: null,
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
  max: "high",
};

/**
 * 按 modelId（+ 可选 templateId）解析推理配置。
 * 内置 pi-native / volcengine-ark 不走此函数（它们自带模型表）。
 */
export function resolveReasoningProfile(
  modelId: string,
  templateId?: string,
): ReasoningProfile {
  const id = modelId.trim().toLowerCase();
  if (!id) return NO_REASONING_PROFILE;

  if (isHunyuanModel(id, templateId)) {
    return {
      reasoning: true,
      supportsReasoningEffort: true,
      thinkingLevelMap: HY4_EFFORT,
    };
  }

  if (isDeepSeekModel(id)) {
    return {
      reasoning: true,
      supportsReasoningEffort: true,
      thinkingFormat: "deepseek",
      thinkingLevelMap: DEEPSEEK_EFFORT,
    };
  }

  if (isQwenThinkingModel(id)) {
    return {
      reasoning: true,
      supportsReasoningEffort: true,
      thinkingFormat: "qwen",
      thinkingLevelMap: QWEN_EFFORT,
    };
  }

  if (isOpenAiReasoningModel(id)) {
    return {
      reasoning: true,
      supportsReasoningEffort: true,
      thinkingLevelMap: OPENAI_EFFORT,
    };
  }

  if (isGlmThinkingModel(id)) {
    return {
      reasoning: true,
      supportsReasoningEffort: true,
      thinkingLevelMap: {
        off: "low",
        minimal: "low",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "max",
        max: "max",
      },
    };
  }

  return NO_REASONING_PROFILE;
}

function isHunyuanModel(id: string, templateId?: string): boolean {
  if (/hunyuan/.test(id)) return true;
  // hy4-preview、hy-4、hy4 等
  if (/(^|[/_\-.])hy\d/.test(id) || /^hy\d/.test(id) || /hy[-_]?\d/.test(id)) return true;
  if (templateId === "tencent-tokenhub" || templateId === "tencent-coding") {
    if (/^hy\b|\bhy[-_]/.test(id) || id.includes("hy4") || id.includes("hy-")) return true;
  }
  return false;
}

function isDeepSeekModel(id: string): boolean {
  return /deepseek/.test(id) || /(^|[/_\-.])r1\b/.test(id);
}

function isQwenThinkingModel(id: string): boolean {
  // 常见思考变体；普通 qwen-plus 等不一定开 enable_thinking，偏保守只匹配明确系列
  return /qwq|qwen3|qwen-?3|qwen-?thinking|qwen-?reason/.test(id);
}

function isOpenAiReasoningModel(id: string): boolean {
  return (
    /(^|[/_\-.])o[1-9]\b/.test(id) ||
    /gpt-5|gpt-6|o3-|o4-|codex/.test(id) ||
    /computer-use|o1-/.test(id)
  );
}

function isGlmThinkingModel(id: string): boolean {
  return /glm-?5|glm-?4\.?\d*v?|chatglm/.test(id);
}
