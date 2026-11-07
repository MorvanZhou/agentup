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

/** 市场团队花名册成员摘要。 */
export interface TeamMemberCard {
  agentId: string;
  name: string;
  role: string;
  sortOrder: number;
  hasAvatar: boolean;
  avatarUrl?: string;
}

/** 市场团队套装名片。 */
export interface TeamCard {
  teamId: string;
  name: string;
  background: string;
  defaultHolderAgentId: string;
  members: TeamMemberCard[];
  recruited: boolean;
  hasAvatar: boolean;
  avatarUrl?: string;
  recruitCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentCard {
  /** recruited=市场；personal=私人助理；local=本机私有（cwd/.pi 同构） */
  kind?: "recruited" | "personal" | "local";
  agentId: string;
  /** 工作规则（名片层 / 本机 AGENTS.md） */
  rules?: string;
  /** 仅 local：已安装到 cwd/.pi/skills 的技能名 */
  skills?: string[];
  /** 仅 local：cwd/.pi/mcp.json 的 mcpServers */
  mcpServers?: Record<string, unknown>;
  /** 仅 local：已绑定的市场 agent_id，再发布时升版 */
  publishedAgentId?: string;
  name: string;
  /** Agent 岗位。 */
  role: string;
  background: string;
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
  background: string;
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

/** 顶层分组：API Key 接入 / CLI 与 SDK 接入 */
export type ProviderAccess = "api" | "agent-sdk";

/** 本地 SDK 状态机，见 .cursor/skills/agentup-sdk-adapter/references/overview.md §2 */
export type AgentSdkState =
  | "not_installed"
  | "installing"
  | "install_failed"
  | "installed"
  | "not_logged_in"
  | "logging_in"
  | "ready"
  | "error";

/** 状态机取值；解析未知状态时回落到 not_installed */
export const AGENT_SDK_STATES: readonly AgentSdkState[] = [
  "not_installed",
  "installing",
  "install_failed",
  "installed",
  "not_logged_in",
  "logging_in",
  "ready",
  "error",
];

/** 本地接入查回来的模型（各家订阅能用什么，只有本机 SDK 知道） */
export interface AgentSdkModelOption {
  id: string;
  name: string;
  /** credit 消耗倍率（如 1.33）；本地 App 才报得出来，没有就是不显示 */
  credits?: number;
  /** 上下文窗口（token）；上游有稳定数值才有 */
  contextWindow?: number;
}

/** CodeBuddy 登录站点：中国站 / 国际站 */
export type AgentSdkAuthEnvironment = "internal" | "external";

/** CLI / SDK 接入卡片：模板静态描述 + 本机状态 */
export interface AgentSdkOption {
  templateId: string;
  vendorLabel: string;
  optionLabel: string;
  label: string;
  hint: string | null;
  package: string;
  sizeHintMb: number;
  loginGuide: { command: string; docUrl: string | null } | null;
  state: AgentSdkState;
  installedVersion: string | null;
  lastError: string | null;
  /** 登录账号的展示名；没登录 / 老 runtime 为 null */
  accountLabel: string | null;
  /** 登录后从本地 SDK 查到的模型目录；没查到时为空 */
  models: AgentSdkModelOption[];
  /** 模板声明的可选登录站点；空 = 不展示站点选择 */
  authEnvironments: AgentSdkAuthEnvironment[];
  /** 本机已选 / 上次登录站点；未选过为 null */
  authEnvironment: AgentSdkAuthEnvironment | null;
  /** 粘贴 Key 文案档；null = 无粘贴能力声明 */
  apiKeyPaste: "opencode" | "github-pat" | "deepseek" | "anthropic" | null;
}

export interface ProviderTemplate {
  id: string;
  vendorId: string;
  vendorLabel: string;
  optionLabel: string;
  label: string;
  kind: string;
  access: ProviderAccess;
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
  /** 稳定厂商 id，设置页 / Composer 按此挂公司 logo */
  vendorId: string;
  vendorLabel: string;
  optionLabel: string;
  /** 模板展示名（如 DeepSeek Harness）；接入标签优先用它 */
  label: string;
  enabled: boolean;
  active: boolean;
  /** 手动追加的模型，可从列表移除 */
  custom: boolean;
  /** credit 消耗倍率；只有本地 App 接入的模型有，API 服务商没有 */
  credits?: number;
  /** 上下文窗口（token）；本地 SDK 目录有才显示 */
  contextWindow?: number;
}

/** 当前 Pi session 选用的模型 + Composer 下拉候选。 */
export interface SessionModelOption {
  templateId: string;
  modelId: string;
  name: string;
  vendorId: string;
  vendorLabel: string;
  optionLabel: string;
  /** 模板展示名；接入标签优先用它 */
  label: string;
  /** credit 消耗倍率；本地 App 才有，下拉右侧显示如 1.58x */
  credits?: number;
  /** 上下文窗口（token）；有才显示如 1M */
  contextWindow?: number;
}

/** 统一：本会话开口和委派用同一个模型。单配：每人用自己一对一里选的模型。 */
export type ModelAssignmentMode = "unified" | "perAgent";

export interface SessionModelState {
  current: ProviderModelRef | null;
  models: SessionModelOption[];
  configured: boolean;
  /** 当前模型是本地 Agent App（SDK）接入：回合中的发送走 followUp 队列。 */
  followUp: boolean;
  /** 一对一会话的分配方式。老响应没有时当统一。 */
  modelMode: ModelAssignmentMode;
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
  /** CLI / SDK 接入候选与状态（第二组） */
  agentSdks: AgentSdkOption[];
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

/** 社区 Skill 检索结果（SkillHub / ClawHub）。 */
export type CommunitySkillSource = "skillhub" | "clawhub";
export type CommunitySkillSort = "downloads" | "updated";

export interface CommunitySkillHit {
  source: CommunitySkillSource;
  id: string;
  slug: string;
  name: string;
  description: string;
  owner?: string;
  version?: string;
  downloads?: number;
  updatedAt?: number;
  homepage?: string;
}

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
  role: string;
  background: string;
  avatarUrl?: string;
}
