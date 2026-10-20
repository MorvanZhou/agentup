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
  summary: string;
  version: number;
  digest: string;
}

export interface AgentCard {
  agentId: string;
  name: string;
  /** 开发者定义的岗位，用户不能改。 */
  role: string;
  summary: string;
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

export type AgentListQuery = {
  q?: string;
  recruited?: boolean;
};
