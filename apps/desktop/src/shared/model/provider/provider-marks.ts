/**
 * 供应商 → 模型品牌标（Lobe Icons 单色 SVG，统一 currentColor）。
 * 按「模型/产品标」而不是母公司字标：Google→Gemini、阿里→Qwen、腾讯→混元，
 * 本地 App：codebuddy → WorkBuddy 标；cursor → Cursor 标（均用户指定 / 产品标）。
 *
 * 来源：@lobehub/icons-static-svg（Lobe Icons；社区整理的厂商标形，仅作 UI 识别）。
 * 文档备忘：.cursor/skills/agentup-sdk-adapter/references/contract.md §7。
 */
import anthropic from "../../assets/providers/anthropic.svg?raw";
import cursor from "../../assets/providers/cursor.svg?raw";
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
  | "workbuddy"
  | "cursor";

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
  // 本地 App：Codex（OpenAI 产品；Lobe 用 openai 标）
  codex: "openai",
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
