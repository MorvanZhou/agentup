import type { listProviderTemplateViews, listVendorGroups } from "../provider-templates.js";
import type { FILE_VERSION } from "./constants.js";

export interface ProviderConnection {
  templateId: string;
  baseUrl?: string;
  apiKeyCipher?: string;
  /** Ollama / 自定义等无目录时用户填写的模型 id */
  customModelIds?: string[];
  /** 从服务商 List Models 拉回的候选（可刷新） */
  discoveredModelIds?: string[];
}

export interface ModelRef {
  templateId: string;
  modelId: string;
}

export interface ProviderConnectionView extends ProviderConnection {
  hasApiKey: boolean;
  piProviderId: string;
  requiresApiKey: boolean;
  vendorId: string;
  vendorLabel: string;
  optionLabel: string;
  label: string;
}

export interface AvailableModelView {
  templateId: string;
  modelId: string;
  name: string;
  /** 稳定厂商 id，桌面端按此挂公司 logo */
  vendorId: string;
  vendorLabel: string;
  optionLabel: string;
  enabled: boolean;
  active: boolean;
  /** 仅手动追加、不在内置/发现目录中，可从列表移除 */
  custom: boolean;
  /** credit 消耗倍率；只有本地 App 报得出来，API 服务商没有 */
  credits?: number;
}

/**
 * 本地 SDK 的安装/登录状态机（见 .cursor/skills/agentup-sdk-adapter/references/overview.md §2）。
 * 阶段 0 只会是 not_installed；阶段 1 起由安装与登录流程推进。
 */
export type AgentSdkState =
  | "not_installed"
  | "installing"
  | "install_failed"
  | "installed"
  | "not_logged_in"
  | "logging_in"
  | "ready"
  | "error";

/** 本地接入查回来的模型目录（各家订阅能用什么只有本地 SDK 知道）。 */
export interface AgentSdkModel {
  id: string;
  name: string;
  /** credit 消耗倍率（如 1.33）；拿不到就没有 */
  credits?: number;
}

/** CodeBuddy 登录站点：internal=中国站，external=国际站。 */
export type AgentSdkAuthEnvironment = "internal" | "external";

/** 落盘记录：只存状态与版本，绝不存 token（登录态归各家 CLI 自己管）。 */
export interface AgentSdkRecord {
  templateId: string;
  state: AgentSdkState;
  installedVersion?: string;
  lastError?: string;
  /** 登录账号的展示名（昵称 / 用户名），只给人看，token 永不落盘 */
  accountLabel?: string;
  /** 登录后向本地 SDK 查到的可用模型；未查到时回落到模板默认项 */
  models?: AgentSdkModel[];
  /**
   * 最近一次选用的登录站点（CodeBuddy）；登出保留，方便下次同站再登。
   * token 仍在各家 CLI，这里只记 environment。
   */
  authEnvironment?: AgentSdkAuthEnvironment;
}

/** 设置页卡片视图 = 模板静态描述 + 本机状态。 */
export interface AgentSdkView {
  templateId: string;
  vendorLabel: string;
  optionLabel: string;
  label: string;
  hint?: string;
  package: string;
  sizeHintMb: number;
  loginGuide?: { command?: string; docUrl?: string };
  state: AgentSdkState;
  installedVersion?: string;
  lastError?: string;
  /** 登录账号展示名；登出后清掉 */
  accountLabel?: string;
  models?: AgentSdkModel[];
  /** 模板声明的可选登录站点；空 = 设置页不展示选择 */
  authEnvironments?: AgentSdkAuthEnvironment[];
  /** 本机已选 / 上次登录站点；未选过为 undefined */
  authEnvironment?: AgentSdkAuthEnvironment;
}

export interface ProviderSettingsView {
  connections: ProviderConnectionView[];
  enabledModels: ModelRef[];
  activeModel: ModelRef | null;
  availableModels: AvailableModelView[];
  configured: boolean;
  overriddenByEnvironment: boolean;
  templates: ReturnType<typeof listProviderTemplateViews>;
  vendors: ReturnType<typeof listVendorGroups>;
  /** CLI / SDK 接入候选与各自状态 */
  agentSdks: AgentSdkView[];
}

/** provider.json 的落盘形状；version 不匹配时按迁移规则处理。 */
export interface StoredFile {
  version: typeof FILE_VERSION;
  connections: ProviderConnection[];
  enabledModels: ModelRef[];
  activeModel: ModelRef | null;
  agentSdks: AgentSdkRecord[];
}

/** 环境变量覆盖（AGENTUP_MODEL_*）解析结果；空串代表没设置。 */
export interface EnvOverrides {
  model: string;
  baseUrl: string;
  apiKey: string;
  provider: string;
}
