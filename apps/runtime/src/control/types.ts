export interface SessionCredential {
  userId: string;
  email: string;
  nickname: string;
  token: string;
  hasAvatar: boolean;
  avatarUrl?: string;
}

export interface RegisterPending {
  email: string;
  status: "pending_verification";
}

export interface PublishedAgent {
  agentId: string;
  name: string;
  role: string;
  background: string;
  version: number;
  digest: string;
}

export interface AgentSkillRef {
  name: string;
  md5: string;
}

export interface AgentCard {
  agentId: string;
  name: string;
  /** 开发者定义的岗位，用户不能改。 */
  role: string;
  background: string;
  /** 工作规则（名片层）；可空。 */
  rules: string;
  /** 当前能力清单里的 skill。编辑页用名字，发布时用 md5 判断要不要重传。 */
  skills: AgentSkillRef[];
  mcpMd5: string;
  settingsMd5: string;
  hooksMd5: string;
  latestVersion: number;
  latestDigest: string;
  recruited: boolean;
  hasAvatar: boolean;
  avatarUrl?: string;
  /** 当前用户对该 Agent 的备注名；未招募为空。 */
  remark: string;
  recruitCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Recruit {
  userId: string;
  agentId: string;
  name: string;
  role: string;
  latestVersion: number;
  latestDigest: string;
  remark: string;
}

export type ThemeMode = "system" | "light" | "dark";
export type UiLocale = "zh" | "en";
export type ChatFontSize = "sm" | "md" | "lg";

export interface UserPreferences {
  themeMode: ThemeMode;
  skipEditResendConfirm: boolean;
  uiLocale: UiLocale;
  chatFontSize: ChatFontSize;
}

export type PreferencesUpdate = {
  themeMode?: ThemeMode;
  skipEditResendConfirm?: boolean;
  uiLocale?: UiLocale;
  chatFontSize?: ChatFontSize;
};

export interface TeamMember {
  agentId: string;
  name: string;
  role: string;
  sortOrder: number;
  hasAvatar: boolean;
  avatarUrl?: string;
}

export interface TeamCard {
  teamId: string;
  name: string;
  background: string;
  defaultHolderAgentId: string;
  members: TeamMember[];
  recruited: boolean;
  hasAvatar: boolean;
  avatarUrl?: string;
  recruitCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TeamRecruitResult {
  teamId: string;
  name: string;
  defaultHolderAgentId: string;
  members: TeamMember[];
}

export interface TeamUpsertInput {
  name: string;
  background: string;
  memberIds: string[];
  defaultHolderAgentId: string;
}

export type AgentListQuery = {
  q?: string;
  recruited?: boolean;
};
