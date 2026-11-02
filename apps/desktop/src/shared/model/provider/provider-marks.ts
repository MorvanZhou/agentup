/**
 * 供应商 → 模型品牌标（Lobe Icons 单色 SVG，统一 currentColor）。
 * 按「模型/产品标」而不是母公司字标：Google→Gemini、阿里→Qwen、腾讯→混元，
 * 本地 App 的 codebuddy 用 WorkBuddy 标（用户指定）。
 *
 * 来源：@lobehub/icons-static-svg（社区整理的厂商标形，仅作 UI 识别）。
 */
import anthropic from "../../assets/providers/anthropic.svg?raw";
import deepseek from "../../assets/providers/deepseek.svg?raw";
import doubao from "../../assets/providers/doubao.svg?raw";
import gemini from "../../assets/providers/gemini.svg?raw";
import hunyuan from "../../assets/providers/hunyuan.svg?raw";
import kimi from "../../assets/providers/kimi.svg?raw";
import meta from "../../assets/providers/meta.svg?raw";
import ollama from "../../assets/providers/ollama.svg?raw";
import openai from "../../assets/providers/openai.svg?raw";
import qwen from "../../assets/providers/qwen.svg?raw";
import workbuddy from "../../assets/providers/workbuddy.svg?raw";
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
  | "workbuddy";

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
