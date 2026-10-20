export type SessionKind = "guest" | "account";

export interface Session {
  /** guest：本机假身份；account：已登录 backend 账号。缺省按 account（兼容旧 session）。 */
  kind?: SessionKind;
  userId: string;
  email: string;
  nickname: string;
  token: string;
  /** 是否已在控制面上传账号头像。 */
  hasAvatar?: boolean;
  /** 控制面静态资源 URL；无自定义时前端用 Lucide 默认。 */
  avatarUrl?: string;
}

export interface AgentCard {
  kind?: "recruited" | "personal";
  agentId: string;
  name: string;
  /** 开发者定义的岗位；用户不能改。私人助理为固定文案。 */
  role: string;
  summary: string;
  latestVersion: number;
  latestDigest: string;
  localVersion: number;
  recruited: boolean;
  hasAvatar: boolean;
  avatarUrl?: string;
  /** 当前用户备注名；未招募或未设置为空。权威在 backend 招募关系。 */
  remark: string;
  /** 累计招募次数：按用户终身去重，解雇/重招不刷数 */
  recruitCount: number;
  /** UTC ISO 字符串：首次创建时间 */
  createdAt: string;
  /** UTC ISO 字符串：最新版本发布时间 */
  updatedAt: string;
}

export type CommandAllowScope = "session" | "agent";

export interface UserState {
  unread: Record<string, number>;
  /** 侧栏最新消息预览；正文真相仍在 sessions/。 */
  previews: Record<string, string>;
  /** 侧栏排序用：各 Agent 最近一轮对话结束时间（毫秒）。 */
  lastActiveAt: Record<string, number>;
  commandAllow: Record<string, CommandAllowScope>;
}

export interface SyncedVisit {
  userId: string;
  agentId: string;
  packageVersion: number;
  packageDigest: string;
}

export interface PublishedAgent {
  agentId: string;
  name: string;
  role: string;
  summary: string;
  version: number;
  digest: string;
}

export interface AgentSourcePreview {
  fileCount: number;
  avatarPreview?: string;
}

export interface PackageIssue {
  path: string;
  message: string;
}

export interface ProviderTemplateModel {
  id: string;
  name: string;
  api: string;
  reasoning: boolean;
}

export interface ProviderTemplate {
  id: string;
  vendorId: string;
  vendorLabel: string;
  optionLabel: string;
  label: string;
  kind: string;
  piProviderId: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  defaultModelId?: string;
  hint?: string;
  api?: string;
  models: ProviderTemplateModel[];
  supportsModelDiscovery: boolean;
}

export interface ProviderVendorGroup {
  id: string;
  label: string;
  options: ProviderTemplate[];
}

export interface ProviderConnection {
  templateId: string;
  baseUrl?: string;
  apiKeyCipher?: string;
  customModelIds: string[];
  discoveredModelIds: string[];
  hasApiKey: boolean;
  piProviderId: string;
  requiresApiKey: boolean;
  vendorId: string;
  vendorLabel: string;
  optionLabel: string;
  label: string;
}

export interface ProviderModelRef {
  templateId: string;
  modelId: string;
}

export interface AvailableProviderModel {
  templateId: string;
  modelId: string;
  name: string;
  vendorLabel: string;
  optionLabel: string;
  enabled: boolean;
  active: boolean;
}

/** 当前 Pi session 选用的模型 + Composer 下拉候选。 */
export interface SessionModelOption {
  templateId: string;
  modelId: string;
  name: string;
  vendorLabel: string;
  optionLabel: string;
}

export interface SessionModelState {
  current: ProviderModelRef | null;
  models: SessionModelOption[];
  configured: boolean;
}

export interface ProviderSettings {
  connections: ProviderConnection[];
  enabledModels: ProviderModelRef[];
  activeModel: ProviderModelRef | null;
  availableModels: AvailableProviderModel[];
  configured: boolean;
  overriddenByEnvironment: boolean;
  vendors: ProviderVendorGroup[];
  templates: ProviderTemplate[];
}

export type ThemeMode = "system" | "light" | "dark";
export type UiLocale = "zh" | "en";

export interface UserPreferences {
  themeMode: ThemeMode;
  skipEditResendConfirm: boolean;
  uiLocale: UiLocale;
}

export type PreferencesUpdate = {
  themeMode?: ThemeMode;
  skipEditResendConfirm?: boolean;
  uiLocale?: UiLocale;
};

/** 私人助理 skill：存 users/<uid>/personal-assistant/skills/，与 ~/.agents 无关。 */
export interface UserSkill {
  name: string;
  description: string;
  enabled: boolean;
}

/** 当前会话可经 `/skill:name` 调用的 skill（私人助理已激活项，或第三方运行包 skills）。 */
export interface InvocableSkill {
  name: string;
  description: string;
}

/** 私人助理 AGENTS.md：存 users/<uid>/personal-assistant/.runtime/AGENTS.md（cwd 外）。 */

export const PERSONAL_ASSISTANT_ID = "personal-assistant";

export interface PersonalAssistantProfile {
  name: string;
  instructions: string;
  avatarUrl?: string;
}
