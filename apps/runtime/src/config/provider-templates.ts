import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { fireworksProvider } from "@earendil-works/pi-ai/providers/fireworks";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { groqProvider } from "@earendil-works/pi-ai/providers/groq";
import { huggingfaceProvider } from "@earendil-works/pi-ai/providers/huggingface";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { metaProvider } from "@earendil-works/pi-ai/providers/meta";
import { minimaxProvider } from "@earendil-works/pi-ai/providers/minimax";
import { minimaxCnProvider } from "@earendil-works/pi-ai/providers/minimax-cn";
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral";
import { moonshotaiProvider } from "@earendil-works/pi-ai/providers/moonshotai";
import { moonshotaiCnProvider } from "@earendil-works/pi-ai/providers/moonshotai-cn";
import { nvidiaProvider } from "@earendil-works/pi-ai/providers/nvidia";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { qwenTokenPlanProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan";
import { qwenTokenPlanCnProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan-cn";
import { qwenTokenPlanIndividualProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan-individual";
import { togetherProvider } from "@earendil-works/pi-ai/providers/together";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";
import { zaiCodingCnProvider } from "@earendil-works/pi-ai/providers/zai-coding-cn";

import { t, type UiLocale } from "../i18n/index.js";
import { allowsMultipleConnections, supportsModelDiscovery } from "./discover-models.js";
import { volcengineArkProviderConfig } from "./providers/volcengine-ark.js";

export type { UiLocale };
/** @deprecated 使用 UiLocale */
export type ProviderUiLocale = UiLocale;

export type ProviderTemplateKind =
  | "pi-native"
  | "custom-openai"
  | "ollama"
  | "volcengine-ark"
  /** 本地 CLI / SDK 接入：执行外包给外部 agent，见 .cursor/skills/agentup-sdk-adapter */
  | "agent-sdk";

/**
 * 接入方式分组（设置页顶层两组）。
 * - api：填 Base URL / API Key，runtime 直连供应商 HTTP 接口
 * - agent-sdk：装本地 SDK 并用订阅登录，任务执行外包给外部 agent
 */
export type ProviderAccess = "api" | "agent-sdk";

/** 本地 SDK 的静态描述；安装与登录在设置页按需触发，目录里只放描述。 */
export interface AgentSdkProfile {
  /**
   * 实现契约的 adaptor id（与 templateId 解耦）。
   * 见 .cursor/skills/agentup-sdk-adapter/references/directory.md §6。
   */
  driverId: "codebuddy" | "claude-code" | "cursor" | "codex" | "opencode" | "copilot" | (string & {});
  /** npm 包名，也用于定位安装目录内的包 */
  package: string;
  /** 安装 spec（含版本范围），避免装到不兼容的大版本 */
  spec: string;
  /**
   * 同前缀额外安装的包（如 OpenCode：主包装 CLI，再装薄 SDK 客户端）。
   * 安装器 `npm install` 时与 `spec` 一并传入；自检仍只认 `package`。
   */
  companionSpecs?: readonly string[];
  /** 安装体积提示，设置页提前告知，别让人以为卡死 */
  sizeHintMb: number;
  loginGuide?: { command?: string; docUrl?: string };
  /**
   * 方案 D：AgentUp `.pi/skills`（及私人助理已启用技能）投影到的**项目相对**路径。
   * 例：CodeBuddy / Workbuddy → `.codebuddy/skills`。
   * 切 provider 时按各模板此字段拆旧链、建新链；未声明则不投影。
   */
  skillsProjectRel?: string;
  /**
   * 登录前可选站点（CodeBuddy：中国站 internal / 国际站 external）。
   * 未声明则设置页不展示站点选择；其它 driver 忽略。
   */
  authEnvironments?: ReadonlyArray<"internal" | "external">;
  /**
   * 粘贴 Key / Token 登录的文案档（Desktop ApiKeyPasteBlock 按此选词条）。
   * 未声明 = 不走粘贴框（除非登录态临时 needs_api_key，则回落 opencode 词条）。
   */
  apiKeyPaste?: "opencode" | "github-pat" | "deepseek" | "anthropic";
}

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
  /** 顶层分组：API Key 接入 / CLI 与 SDK 接入 */
  access: ProviderAccess;
  piProviderId: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  defaultModelId?: string;
  hint?: string;
  createNative?: () => Provider;
  api?: Api;
  models?: ProviderTemplateModel[];
  /** 仅 agent-sdk：本地安装与登录的静态描述 */
  agentSdk?: AgentSdkProfile;
  /** 是否可通过 List Models 自动发现候选 */
  supportsModelDiscovery: boolean;
  /** 是否允许同一模板配置多条连接（不同 Base URL） */
  allowsMultipleConnections: boolean;
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
  agentSdk?: AgentSdkProfile;
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
    access: def.kind === "agent-sdk" ? "agent-sdk" : "api",
    agentSdk: def.agentSdk,
    piProviderId: def.piProviderId,
    requiresApiKey: def.requiresApiKey,
    defaultBaseUrl: def.defaultBaseUrl,
    defaultModelId: def.defaultModelId,
    hint: def.hint ? resolveCopy(def.hint, locale) : undefined,
    createNative: def.createNative,
    api: def.api,
    models: def.models,
    supportsModelDiscovery: supportsModelDiscovery(def.kind),
    allowsMultipleConnections: allowsMultipleConnections(def.kind),
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
    defaultBaseUrl: "http://localhost:11434/v1/chat/completions",
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
  // A 档补齐：pi-ai 内置 factory，API Key 直连（与现有 native 同路径）
  native(
    "openrouter",
    "openrouter",
    "OpenRouter",
    OFFICIAL_API,
    openrouterProvider,
    { key: "provider.template.openrouter.hint" },
  ),
  native("xai", "xai", "xAI", OFFICIAL_API, xaiProvider),
  native("mistral", "mistral", "Mistral", OFFICIAL_API, mistralProvider),
  native("groq", "groq", "Groq", OFFICIAL_API, groqProvider),
  native("minimax", "minimax", "MiniMax", { key: "provider.option.minimaxIntl" }, minimaxProvider),
  native("minimax-cn", "minimax", "MiniMax", { key: "provider.option.minimaxCn" }, minimaxCnProvider),
  native("fireworks", "fireworks", "Fireworks", OFFICIAL_API, fireworksProvider),
  native("together", "together", "Together AI", OFFICIAL_API, togetherProvider),
  native("nvidia", "nvidia", "NVIDIA", "NIM", nvidiaProvider),
  native(
    "huggingface",
    "huggingface",
    "Hugging Face",
    OFFICIAL_API,
    huggingfaceProvider,
    { key: "provider.template.huggingface.hint" },
  ),
  // OpenCode 模型网关（API Key）；整套本地 agent 走 opencode-sdk，勿混
  native(
    "opencode",
    "opencode",
    "OpenCode",
    "Zen",
    opencodeProvider,
    { key: "provider.template.opencode.hint" },
  ),
  native(
    "opencode-go",
    "opencode",
    "OpenCode",
    "Go",
    opencodeGoProvider,
    { key: "provider.template.opencode-go.hint" },
  ),
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
    // Anthropic Claude Agent SDK：本机 agent loop；Console API Key（禁未批准的 claude.ai 登录）
    // 外显名 Claude Code（产品选择）；登录后 models 由 Models API 覆盖
    id: "claude-agent-sdk",
    vendorId: "anthropic",
    vendorLabel: "Claude Code",
    optionLabel: { key: "provider.option.agentSdk" },
    label: { key: "provider.template.claude-agent-sdk.label" },
    kind: "agent-sdk",
    piProviderId: "claude-agent-sdk",
    requiresApiKey: false,
    // 登录前无占位假目录；登录后由 Models API 覆盖写入（无 defaultModelId）
    hint: { key: "provider.template.claude-agent-sdk.hint" },
    models: [],
    agentSdk: {
      driverId: "claude-code",
      package: "@anthropic-ai/claude-agent-sdk",
      // 钉版：平台 optionalDeps（claude-agent-sdk-<os>-<arch>）同号；升级时同步
      spec: "@anthropic-ai/claude-agent-sdk@0.3.318",
      // 含平台 native CLI（解压约 230–300MB）
      sizeHintMb: 300,
      loginGuide: {
        command: "paste Anthropic API Key",
        docUrl: "https://console.anthropic.com/settings/keys",
      },
      // 方案 D：投影到 cwd/.claude/skills
      skillsProjectRel: ".claude/skills",
      apiKeyPaste: "anthropic",
    },
  },
  {
    // CLI / SDK 接入（形态 B）：任务执行外包给 CodeBuddy agent，阶段 0 只登记目录与状态
    id: "codebuddy-sdk",
    vendorId: "codebuddy",
    vendorLabel: "Workbuddy / CodeBuddy",
    optionLabel: { key: "provider.option.agentSdk" },
    label: { key: "provider.template.codebuddy-sdk.label" },
    kind: "agent-sdk",
    piProviderId: "codebuddy-sdk",
    requiresApiKey: false,
    defaultModelId: "default",
    hint: { key: "provider.template.codebuddy-sdk.hint" },
    models: [
      {
        id: "default",
        name: "CodeBuddy 默认模型",
        api: "agentup-agent-sdk",
        reasoning: false,
      },
    ],
    agentSdk: {
      driverId: "codebuddy",
      package: "@tencent-ai/agent-sdk",
      spec: "@tencent-ai/agent-sdk@0.3.295",
      sizeHintMb: 180,
      loginGuide: { command: "cbc login" },
      // 厂商项目技能目录；换其它 agent-sdk 模板时由 skills-project 换链
      skillsProjectRel: ".codebuddy/skills",
      // 登录前选中国站 / 国际站 → unstable_v2_authenticate({ environment })
      authEnvironments: ["internal", "external"],
    },
  },
  {
    // Cursor 本地 Agent App：推理走 Cursor 托管模型，本机跑 agent loop / 读盘
    id: "cursor-sdk",
    vendorId: "cursor",
    vendorLabel: "Cursor",
    optionLabel: { key: "provider.option.agentSdk" },
    label: { key: "provider.template.cursor-sdk.label" },
    kind: "agent-sdk",
    piProviderId: "cursor-sdk",
    requiresApiKey: false,
    defaultModelId: "default",
    hint: { key: "provider.template.cursor-sdk.hint" },
    models: [
      {
        id: "default",
        name: "Cursor 默认模型",
        api: "agentup-agent-sdk",
        reasoning: false,
      },
    ],
    agentSdk: {
      driverId: "cursor",
      package: "@cursor/sdk",
      // 钉版本：平台原生包与主包同号；升级时同步 optionalDependencies
      spec: "@cursor/sdk@1.2.0",
      sizeHintMb: 120,
      loginGuide: {
        command: "cursor-sdk login",
        docUrl: "https://cursor.com/docs/sdk/typescript",
      },
      skillsProjectRel: ".cursor/skills",
    },
  },
  {
    // OpenAI Codex 本地 Agent App：ChatGPT 订阅登录；CLI 经 @openai/codex-sdk 拉起
    id: "codex-sdk",
    vendorId: "codex",
    vendorLabel: "Codex",
    optionLabel: { key: "provider.option.agentSdk" },
    label: { key: "provider.template.codex-sdk.label" },
    kind: "agent-sdk",
    piProviderId: "codex-sdk",
    requiresApiKey: false,
    defaultModelId: "default",
    hint: { key: "provider.template.codex-sdk.hint" },
    models: [
      {
        id: "default",
        name: "Codex 默认模型",
        api: "agentup-agent-sdk",
        reasoning: false,
      },
    ],
    agentSdk: {
      driverId: "codex",
      package: "@openai/codex-sdk",
      // 钉版本：与捆绑 @openai/codex / 平台 optionalDeps 同号
      spec: "@openai/codex-sdk@0.166.0",
      // 含平台原生 CLI（约 350MB+）
      sizeHintMb: 360,
      loginGuide: {
        command: "codex login",
        docUrl: "https://learn.chatgpt.com/docs/codex-sdk",
      },
      skillsProjectRel: ".agents/skills",
    },
  },
  {
    // OpenCode 本地 Agent App：官方 opencode/Zen 账号模型与额度；隔离 home，不 Attach Desktop
    id: "opencode-sdk",
    vendorId: "opencode",
    vendorLabel: "OpenCode",
    optionLabel: { key: "provider.option.agentSdk" },
    label: { key: "provider.template.opencode-sdk.label" },
    kind: "agent-sdk",
    piProviderId: "opencode-sdk",
    requiresApiKey: false,
    defaultModelId: "default",
    hint: { key: "provider.template.opencode-sdk.hint" },
    models: [
      {
        id: "default",
        name: "OpenCode 默认模型",
        api: "agentup-agent-sdk",
        reasoning: false,
      },
    ],
    agentSdk: {
      driverId: "opencode",
      // 主包：平台 CLI（optionalDeps）；薄 SDK 经 companionSpecs 同前缀安装
      package: "opencode-ai",
      spec: "opencode-ai@1.19.5",
      companionSpecs: ["@opencode-ai/sdk@1.19.5"],
      sizeHintMb: 180,
      loginGuide: {
        command: "opencode auth login opencode",
        docUrl: "https://opencode.ai/docs/providers/",
      },
      skillsProjectRel: ".opencode/skills",
      apiKeyPaste: "opencode",
    },
  },
  {
    // DeepSeek Harness 本地 Agent App：粘贴平台 API Key；stdio JSON-RPC 启流
    // vendorId 与官方 API 的 deepseek 分开，Desktop 标形可区分（文案仍是 DeepSeek）
    id: "deepseek-harness-sdk",
    vendorId: "deepseek-harness",
    vendorLabel: "DeepSeek",
    optionLabel: { key: "provider.option.agentSdk" },
    label: { key: "provider.template.deepseek-harness-sdk.label" },
    kind: "agent-sdk",
    piProviderId: "deepseek-harness-sdk",
    requiresApiKey: false,
    // 登录前占位；登录后 lifecycle 写入 curated（无活 list API）
    defaultModelId: "deepseek-flash",
    hint: { key: "provider.template.deepseek-harness-sdk.hint" },
    models: [
      {
        id: "deepseek-flash",
        name: "DeepSeek V4.1 Flash",
        api: "agentup-agent-sdk",
        reasoning: false,
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        api: "agentup-agent-sdk",
        reasoning: false,
      },
    ],
    agentSdk: {
      driverId: "dsh",
      package: "@deepseek-ai/dsh-sdk-client",
      // 钉版：client 依赖同号 @deepseek-ai/dsh；升级须同号
      spec: "@deepseek-ai/dsh-sdk-client@0.2.2-rc.1",
      // 依赖树含完整 harness 插件；提示体积避免用户以为卡死
      sizeHintMb: 100,
      loginGuide: {
        command: "paste DeepSeek API Key",
        docUrl: "https://platform.deepseek.com/api_keys",
      },
      // 方案 D：项目根优先扫描 .dsh/skills
      skillsProjectRel: ".dsh/skills",
      apiKeyPaste: "deepseek",
    },
  },
  {
    // GitHub Copilot 本地 Agent App：订阅登录；CLI 经 @github/copilot-sdk 拉起
    id: "copilot-sdk",
    vendorId: "copilot",
    vendorLabel: "GitHub Copilot",
    optionLabel: { key: "provider.option.agentSdk" },
    label: { key: "provider.template.copilot-sdk.label" },
    kind: "agent-sdk",
    piProviderId: "copilot-sdk",
    requiresApiKey: false,
    defaultModelId: "auto",
    hint: { key: "provider.template.copilot-sdk.hint" },
    models: [
      {
        id: "auto",
        name: "Copilot Auto",
        api: "agentup-agent-sdk",
        reasoning: false,
      },
    ],
    agentSdk: {
      driverId: "copilot",
      package: "@github/copilot-sdk",
      // 钉版本：平台 optionalDeps（@github/copilot-sdk-<os>-<arch>）同号
      spec: "@github/copilot-sdk@1.0.28",
      // 含平台 CLI runtime（解压约 150MB）
      sizeHintMb: 160,
      loginGuide: {
        // SDK 无 LoginAsync；设置页粘贴 fine-grained PAT（需 Copilot Requests）
        command: "paste GitHub token",
        docUrl: "https://github.com/settings/personal-access-tokens",
      },
      // 方案 D：投影到 cwd；Turn 时再经 skillDirectories 显式传入
      skillsProjectRel: ".github/skills",
      // 设置页粘贴 fine-grained PAT；词条含 Account 权限提醒
      apiKeyPaste: "github-pat",
    },
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
    defaultBaseUrl: "https://api.openai.com/v1/chat/completions",
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

/** CLI / SDK 接入的候选（顶层第二组，不进 vendor 下拉）。 */
export function listAgentSdkTemplates(
  locale: UiLocale = "zh",
): Array<Omit<ProviderTemplate, "createNative">> {
  return listProviderTemplateViews(locale).filter((template) => template.access === "agent-sdk");
}

/** 当前模板的 skills 投影相对路径（方案 D）；非 SDK / 未声明则 undefined。 */
export function agentSdkSkillsProjectRel(templateId: string): string | undefined {
  const rel = getProviderTemplate(templateId)?.agentSdk?.skillsProjectRel?.trim();
  return rel || undefined;
}

/** 所有已登记 SDK 模板的投影路径（切 provider 时用来扫掉其它厂商残留链）。 */
export function listAgentSdkSkillsProjectRels(): string[] {
  const rels = new Set<string>();
  for (const template of listAgentSdkTemplates()) {
    const rel = template.agentSdk?.skillsProjectRel?.trim();
    if (rel) rels.add(rel);
  }
  return [...rels];
}

export function listVendorGroups(locale: UiLocale = "zh"): VendorGroup[] {
  const order: string[] = [];
  const map = new Map<string, VendorGroup>();
  for (const template of listProviderTemplateViews(locale)) {
    // SDK 接入不靠 Base URL / API Key，混进供应商下拉会让表单出现无意义字段
    if (template.access === "agent-sdk") continue;
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
