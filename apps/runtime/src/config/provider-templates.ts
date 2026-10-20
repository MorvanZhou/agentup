import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { metaProvider } from "@earendil-works/pi-ai/providers/meta";
import { moonshotaiProvider } from "@earendil-works/pi-ai/providers/moonshotai";
import { moonshotaiCnProvider } from "@earendil-works/pi-ai/providers/moonshotai-cn";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { qwenTokenPlanProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan";
import { qwenTokenPlanCnProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan-cn";
import { qwenTokenPlanIndividualProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan-individual";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";
import { zaiCodingCnProvider } from "@earendil-works/pi-ai/providers/zai-coding-cn";

import { t, type UiLocale } from "../i18n/index.js";
import { supportsModelDiscovery } from "./discover-models.js";
import { volcengineArkProviderConfig } from "./providers/volcengine-ark.js";

export type { UiLocale };
/** @deprecated 使用 UiLocale */
export type ProviderUiLocale = UiLocale;

export type ProviderTemplateKind = "pi-native" | "custom-openai" | "ollama" | "volcengine-ark";

/** 专有名用 string；需翻译用 catalog key。 */
type Copy = string | { key: string };

export interface ProviderTemplateModel {
  id: string;
  name: string;
  api: string;
  reasoning: boolean;
}

export interface ProviderTemplate {
  id: string;
  /** 一级：供应商 */
  vendorId: string;
  vendorLabel: string;
  /** 二级：该供应商下的接入方式（仅一个时可与 vendorLabel 相同） */
  optionLabel: string;
  label: string;
  kind: ProviderTemplateKind;
  piProviderId: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  defaultModelId?: string;
  hint?: string;
  createNative?: () => Provider;
  api?: Api;
  models?: ProviderTemplateModel[];
  /** 是否可通过 List Models 自动发现候选 */
  supportsModelDiscovery: boolean;
}

export interface VendorGroup {
  id: string;
  label: string;
  options: Array<Omit<ProviderTemplate, "createNative">>;
}

interface TemplateDef {
  id: string;
  vendorId: string;
  vendorLabel: Copy;
  optionLabel: Copy;
  /** 缺省则 `vendor · option`（两者相同时只用 vendor） */
  label?: Copy;
  kind: ProviderTemplateKind;
  piProviderId: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  defaultModelId?: string;
  hint?: Copy;
  createNative?: () => Provider;
  api?: Api;
  models?: ProviderTemplateModel[];
}

const OFFICIAL_API: Copy = { key: "provider.option.officialApi" };
const CODING_PLAN = "Coding Plan";

function resolveCopy(value: Copy, locale: UiLocale): string {
  return typeof value === "string" ? value : t(value.key, locale);
}

function resolveTemplate(def: TemplateDef, locale: UiLocale): ProviderTemplate {
  const vendorLabel = resolveCopy(def.vendorLabel, locale);
  const optionLabel = resolveCopy(def.optionLabel, locale);
  const label = def.label
    ? resolveCopy(def.label, locale)
    : optionLabel === vendorLabel
      ? vendorLabel
      : `${vendorLabel} · ${optionLabel}`;
  return {
    id: def.id,
    vendorId: def.vendorId,
    vendorLabel,
    optionLabel,
    label,
    kind: def.kind,
    piProviderId: def.piProviderId,
    requiresApiKey: def.requiresApiKey,
    defaultBaseUrl: def.defaultBaseUrl,
    defaultModelId: def.defaultModelId,
    hint: def.hint ? resolveCopy(def.hint, locale) : undefined,
    createNative: def.createNative,
    api: def.api,
    models: def.models,
    supportsModelDiscovery: supportsModelDiscovery(def.kind),
  };
}

function modelsOf(provider: Provider): ProviderTemplateModel[] {
  return provider.getModels().map((model: Model<Api>) => ({
    id: model.id,
    name: model.name || model.id,
    api: model.api,
    reasoning: Boolean(model.reasoning),
  }));
}

function native(
  id: string,
  vendorId: string,
  vendorLabel: Copy,
  optionLabel: Copy,
  create: () => Provider,
  hint?: Copy,
): TemplateDef {
  const provider = create();
  const models = modelsOf(provider);
  return {
    id,
    vendorId,
    vendorLabel,
    optionLabel,
    kind: "pi-native",
    piProviderId: provider.id,
    requiresApiKey: true,
    defaultModelId: models[0]?.id,
    hint,
    createNative: create,
    models,
  };
}

const TEMPLATE_DEFS: TemplateDef[] = [
  {
    id: "ollama",
    vendorId: "ollama",
    vendorLabel: { key: "provider.vendor.ollama" },
    optionLabel: { key: "provider.option.localService" },
    label: { key: "provider.template.ollama.label" },
    kind: "ollama",
    piProviderId: "ollama",
    requiresApiKey: false,
    defaultBaseUrl: "http://localhost:11434/v1",
    defaultModelId: "qwen3:4b",
    hint: { key: "provider.template.ollama.hint" },
    api: "openai-completions",
    models: [],
  },
  native("openai", "openai", "OpenAI", OFFICIAL_API, openaiProvider),
  native("anthropic", "anthropic", "Anthropic", OFFICIAL_API, anthropicProvider),
  native("google", "google", "Google", "Gemini", googleProvider),
  native("deepseek", "deepseek", "DeepSeek", OFFICIAL_API, deepseekProvider),
  native("meta", "meta", "Meta", "Muse", metaProvider, "Meta Model API"),
  native("moonshotai", "kimi", "Kimi", { key: "provider.option.moonshotIntl" }, moonshotaiProvider),
  native("moonshotai-cn", "kimi", "Kimi", { key: "provider.option.moonshotCn" }, moonshotaiCnProvider),
  native(
    "kimi-coding",
    "kimi",
    "Kimi",
    "Kimi For Coding",
    kimiCodingProvider,
    { key: "provider.template.kimi-coding.hint" },
  ),
  native("zai", "zhipu", { key: "provider.vendor.zhipu" }, "Z.AI", zaiProvider),
  native(
    "zai-coding-cn",
    "zhipu",
    { key: "provider.vendor.zhipu" },
    CODING_PLAN,
    zaiCodingCnProvider,
    { key: "provider.template.zai-coding-cn.hint" },
  ),
  native(
    "qwen-token-plan",
    "alibaba",
    { key: "provider.vendor.alibaba" },
    "Qwen Token Plan",
    qwenTokenPlanProvider,
  ),
  native(
    "qwen-token-plan-cn",
    "alibaba",
    { key: "provider.vendor.alibaba" },
    { key: "provider.option.qwenTokenPlanCn" },
    qwenTokenPlanCnProvider,
  ),
  native(
    "qwen-token-plan-individual",
    "alibaba",
    { key: "provider.vendor.alibaba" },
    "Qwen Token Plan Individual",
    qwenTokenPlanIndividualProvider,
  ),
  {
    id: "volcengine-ark",
    vendorId: "bytedance",
    vendorLabel: { key: "provider.vendor.bytedance" },
    optionLabel: { key: "provider.option.volcengineArk" },
    label: { key: "provider.template.volcengine-ark.label" },
    kind: "volcengine-ark",
    piProviderId: volcengineArkProviderConfig.id,
    requiresApiKey: true,
    defaultBaseUrl: volcengineArkProviderConfig.baseUrl,
    defaultModelId: volcengineArkProviderConfig.models[0]?.id,
    hint: { key: "provider.template.volcengine-ark.hint" },
    api: "openai-completions",
    models: volcengineArkProviderConfig.models.map((model) => ({
      id: model.id,
      name: model.name,
      api: "openai-completions",
      reasoning: model.reasoning,
    })),
  },
  {
    id: "tencent-tokenhub",
    vendorId: "tencent",
    vendorLabel: { key: "provider.vendor.tencent" },
    optionLabel: "TokenHub",
    label: { key: "provider.template.tencent-tokenhub.label" },
    kind: "custom-openai",
    piProviderId: "tencent-tokenhub",
    requiresApiKey: true,
    defaultBaseUrl: "https://tokenhub.tencentmaas.com/v1",
    hint: { key: "provider.template.tencent-tokenhub.hint" },
    api: "openai-completions",
    models: [],
  },
  {
    id: "tencent-coding",
    vendorId: "tencent",
    vendorLabel: { key: "provider.vendor.tencent" },
    optionLabel: CODING_PLAN,
    label: { key: "provider.template.tencent-coding.label" },
    kind: "custom-openai",
    piProviderId: "tencent-coding",
    requiresApiKey: true,
    defaultBaseUrl: "https://api.lkeap.cloud.tencent.com/coding/v3",
    hint: { key: "provider.template.tencent-coding.hint" },
    api: "openai-completions",
    models: [],
  },
  {
    id: "custom-openai",
    vendorId: "custom",
    vendorLabel: { key: "provider.vendor.custom" },
    optionLabel: { key: "provider.option.openaiCompatible" },
    label: { key: "provider.template.custom-openai.label" },
    kind: "custom-openai",
    piProviderId: "custom-openai",
    requiresApiKey: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    api: "openai-completions",
    models: [],
  },
];

const BY_ID = new Map(TEMPLATE_DEFS.map((item) => [item.id, item]));

/** 结构字段（建连 / 拉模型）；文案按 locale，默认中文。 */
export function getProviderTemplate(id: string, locale: UiLocale = "zh"): ProviderTemplate | undefined {
  const def = BY_ID.get(id);
  return def ? resolveTemplate(def, locale) : undefined;
}

export function listProviderTemplateViews(
  locale: UiLocale = "zh",
): Array<Omit<ProviderTemplate, "createNative">> {
  return TEMPLATE_DEFS.map((def) => {
    const { createNative: _factory, ...rest } = resolveTemplate(def, locale);
    return {
      ...rest,
      models: rest.models ? [...rest.models] : [],
    };
  });
}

export function listVendorGroups(locale: UiLocale = "zh"): VendorGroup[] {
  const order: string[] = [];
  const map = new Map<string, VendorGroup>();
  for (const template of listProviderTemplateViews(locale)) {
    let group = map.get(template.vendorId);
    if (!group) {
      group = { id: template.vendorId, label: template.vendorLabel, options: [] };
      map.set(template.vendorId, group);
      order.push(template.vendorId);
    }
    group.options.push(template);
  }
  return order.map((id) => map.get(id)!);
}
