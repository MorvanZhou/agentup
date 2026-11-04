/**
 * 供应商 → 模型品牌标（Lobe Icons 单色 SVG，统一 currentColor）。
 * 按「模型/产品标」而不是母公司字标：Google→Gemini、阿里→Qwen、腾讯→混元，
 * 本地 App：codebuddy → WorkBuddy 标；cursor → Cursor 标；opencode → 官方方标（均产品标）。
 *
 * 来源：多数出自 @lobehub/icons-static-svg（Lobe Icons）；OpenCode 方标改编自
 * anomalyco/opencode brand `opencode-logo-light-square.svg`（单色 currentColor）。
 * 文档备忘：.cursor/skills/agentup-sdk-adapter/references/contract.md §7。
 */
import anthropic from "../../assets/providers/anthropic.svg?raw";
import cursor from "../../assets/providers/cursor.svg?raw";
import deepseek from "../../assets/providers/deepseek.svg?raw";
import doubao from "../../assets/providers/doubao.svg?raw";
import fireworks from "../../assets/providers/fireworks.svg?raw";
import gemini from "../../assets/providers/gemini.svg?raw";
import groq from "../../assets/providers/groq.svg?raw";
import huggingface from "../../assets/providers/huggingface.svg?raw";
import hunyuan from "../../assets/providers/hunyuan.svg?raw";
import kimi from "../../assets/providers/kimi.svg?raw";
import meta from "../../assets/providers/meta.svg?raw";
import minimax from "../../assets/providers/minimax.svg?raw";
import mistral from "../../assets/providers/mistral.svg?raw";
import nvidia from "../../assets/providers/nvidia.svg?raw";
import ollama from "../../assets/providers/ollama.svg?raw";
import openai from "../../assets/providers/openai.svg?raw";
import opencode from "../../assets/providers/opencode.svg?raw";
import openrouter from "../../assets/providers/openrouter.svg?raw";
import qwen from "../../assets/providers/qwen.svg?raw";
import together from "../../assets/providers/together.svg?raw";
import workbuddy from "../../assets/providers/workbuddy.svg?raw";
import xai from "../../assets/providers/xai.svg?raw";
import zai from "../../assets/providers/zai.svg?raw";

export type ProviderMarkId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "meta"
  | "kimi"
  | "qwen"
  | "zai"
  | "doubao"
  | "hunyuan"
  | "ollama"
  | "workbuddy"
  | "cursor"
  | "opencode"
  | "openrouter"
  | "xai"
  | "mistral"
  | "groq"
  | "minimax"
  | "fireworks"
  | "together"
  | "nvidia"
  | "huggingface";

/** vendorId → 模型标 id */
const VENDOR_TO_MARK: Record<string, ProviderMarkId> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "gemini",
  deepseek: "deepseek",
  meta: "meta",
  kimi: "kimi",
  zhipu: "zai",
  alibaba: "qwen",
  // 火山方舟挂的是豆包系模型，标用豆包
  bytedance: "doubao",
  tencent: "hunyuan",
  ollama: "ollama",
  // 本地 App：模板 vendorId 仍是 codebuddy，标形用 WorkBuddy
  codebuddy: "workbuddy",
  workbuddy: "workbuddy",
  // 本地 App：Cursor SDK（与 WorkBuddy 同出 @lobehub/icons-static-svg）
  cursor: "cursor",
  // 本地 App：OpenCode（官方 brand 方标，单色）
  opencode: "opencode",
  // 本地 App：Codex（OpenAI 产品；Lobe 用 openai 标）
  codex: "openai",
  // A 档 pi-native：vendorId 与模板一致
  openrouter: "openrouter",
  xai: "xai",
  mistral: "mistral",
  groq: "groq",
  minimax: "minimax",
  fireworks: "fireworks",
  together: "together",
  nvidia: "nvidia",
  huggingface: "huggingface",
};

const MARK_SVG: Record<ProviderMarkId, string> = {
  openai,
  anthropic,
  gemini,
  deepseek,
  meta,
  kimi,
  qwen,
  zai,
  doubao,
  hunyuan,
  ollama,
  workbuddy,
  cursor,
  opencode,
  openrouter,
  xai,
  mistral,
  groq,
  minimax,
  fireworks,
  together,
  nvidia,
  huggingface,
};

export function resolveProviderMarkId(vendorId: string | null | undefined): ProviderMarkId | null {
  const id = (vendorId ?? "").trim().toLowerCase();
  if (!id) return null;
  return VENDOR_TO_MARK[id] ?? null;
}

export function providerMarkSvg(vendorId: string | null | undefined): string | null {
  const mark = resolveProviderMarkId(vendorId);
  return mark ? MARK_SVG[mark] : null;
}
