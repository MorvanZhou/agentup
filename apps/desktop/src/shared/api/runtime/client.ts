import type { UIMessage } from "ai";

import type { AskUserAnswer } from "../../model/chat";
import type {
  AgentCard,
  AgentSourcePreview,
  InvocableSkill,
  PersonalAssistantProfile,
  ProviderModelRef,
  ProviderSettings,
  PublishedAgent,
  Session,
  SessionModelState,
  SyncedVisit,
  PreferencesUpdate,
  UiLocale,
  UserSkill,
  UserState,
  UserPreferences,
} from "../../model/runtime";

import * as agentsApi from "./agents";
import * as attachmentsApi from "./attachments";
import * as authApi from "./auth";
import { runtimeBaseUrl } from "./base-url";
import * as chatApi from "./chat";
import { RuntimeHttp } from "./http";
import * as settingsApi from "./settings";
import * as stateApi from "./state";
import * as workspaceApi from "./workspace";
import type { WorkspaceEntry, WorkspaceFile } from "./workspace";
import type { StagedAttachment } from "./attachments";

/** 本机 runtime 的桌面端 API 门面；按领域拆在同目录其它文件。 */
export class DesktopApi {
  private readonly http: RuntimeHttp;

  constructor(baseUrl = runtimeBaseUrl(), fetchImpl: typeof fetch = fetch) {
    this.http = new RuntimeHttp(baseUrl, fetchImpl);
  }

  register(
    email: string,
    password: string,
    turnstileToken = "",
  ): Promise<authApi.RegisterPending> {
    return authApi.register(this.http, email, password, turnstileToken);
  }

  login(email: string, password: string): Promise<Session> {
    return authApi.login(this.http, email, password);
  }

  resendVerification(email: string, password: string, turnstileToken = ""): Promise<void> {
    return authApi.resendVerification(this.http, email, password, turnstileToken);
  }

  verifyEmail(email: string, code: string): Promise<Session> {
    return authApi.verifyEmail(this.http, email, code);
  }

  forgotPassword(email: string, turnstileToken = ""): Promise<void> {
    return authApi.forgotPassword(this.http, email, turnstileToken);
  }

  resetPassword(email: string, code: string, password: string): Promise<Session> {
    return authApi.resetPassword(this.http, email, code, password);
  }

  oauthAuthorizeUrl(provider: "github" | "google", loopbackUri: string): Promise<string> {
    return authApi.oauthAuthorizeUrl(this.http, provider, loopbackUri);
  }

  oauthExchange(code: string): Promise<Session> {
    return authApi.oauthExchange(this.http, code);
  }

  turnstileInfo(): Promise<authApi.TurnstileInfo> {
    return authApi.turnstileInfo(this.http);
  }

  updateProfile(
    token: string,
    nickname: string,
    options: { avatarBase64?: string } = {},
  ): Promise<Session> {
    return authApi.updateProfile(this.http, token, nickname, options);
  }

  migrateGuestUser(token: string, fromUserId: string, toUserId: string): Promise<void> {
    return authApi.migrateGuestUser(this.http, token, fromUserId, toUserId);
  }

  personalAssistantProfile(
    token: string,
    userId: string,
    locale?: UiLocale,
  ): Promise<PersonalAssistantProfile> {
    return settingsApi.personalAssistantProfile(this.http, token, userId, locale);
  }

  savePersonalAssistantProfile(
    token: string,
    userId: string,
    profile: { name: string; role: string; background: string; avatarDataUrl?: string },
    locale?: UiLocale,
  ): Promise<PersonalAssistantProfile> {
    return settingsApi.savePersonalAssistantProfile(this.http, token, userId, profile, locale);
  }

  agents(
    token: string,
    options?: { userId?: string; q?: string; recruited?: boolean },
  ): Promise<AgentCard[]> {
    return agentsApi.agents(this.http, token, options);
  }

  localAgents(token: string, userId: string, options?: { q?: string }): Promise<AgentCard[]> {
    return agentsApi.localAgents(this.http, token, userId, options);
  }

  createLocalAgent(
    token: string,
    userId: string,
    input: {
      name: string;
      role: string;
      background: string;
      rules?: string;
      avatarDataUrl?: string;
      skillPaths?: string[];
      mcpServers?: Record<string, unknown>;
    },
  ): Promise<AgentCard> {
    return agentsApi.createLocalAgent(this.http, token, userId, input);
  }

  getLocalAgent(token: string, userId: string, agentId: string): Promise<AgentCard> {
    return agentsApi.getLocalAgent(this.http, token, userId, agentId);
  }

  updateLocalAgent(
    token: string,
    userId: string,
    agentId: string,
    input: {
      name: string;
      role: string;
      background: string;
      rules?: string;
      avatarDataUrl?: string;
      skillPaths?: string[];
      removeSkills?: string[];
      mcpServers?: Record<string, unknown>;
    },
  ): Promise<AgentCard> {
    return agentsApi.updateLocalAgent(this.http, token, userId, agentId, input);
  }

  bindLocalPublishedAgent(
    token: string,
    userId: string,
    agentId: string,
    publishedAgentId: string,
  ): Promise<AgentCard> {
    return agentsApi.bindLocalPublishedAgent(this.http, token, userId, agentId, publishedAgentId);
  }

  exportLocalAgentSkill(
    token: string,
    userId: string,
    agentId: string,
    skillName: string,
    destination: string,
  ): Promise<{ path: string }> {
    return agentsApi.exportLocalAgentSkill(this.http, token, userId, agentId, skillName, destination);
  }

  deleteLocalAgent(token: string, userId: string, agentId: string): Promise<void> {
    return agentsApi.deleteLocalAgent(this.http, token, userId, agentId);
  }

  publicAgents(options?: { q?: string }): Promise<AgentCard[]> {
    return agentsApi.publicAgents(this.http, options);
  }

  state(token: string, userId: string): Promise<UserState> {
    return stateApi.state(this.http, token, userId);
  }

  saveState(
    token: string,
    userId: string,
    unread: Record<string, number>,
    previews: Record<string, string>,
    lastActiveAt: Record<string, number>,
  ): Promise<UserState> {
    return stateApi.saveState(this.http, token, userId, unread, previews, lastActiveAt);
  }

  setRemark(token: string, agentId: string, remark: string): Promise<string> {
    return agentsApi.setRemark(this.http, token, agentId, remark);
  }

  ownedAgents(token: string, options?: { q?: string }): Promise<AgentCard[]> {
    return agentsApi.ownedAgents(this.http, token, options);
  }

  providerSettings(token: string, locale?: UiLocale): Promise<ProviderSettings> {
    return settingsApi.providerSettings(this.http, token, locale);
  }

  upsertProviderConnection(
    token: string,
    connection: {
      templateId: string;
      baseUrl?: string;
      apiKeyCipher?: string;
      clearApiKey?: boolean;
      customModelId?: string;
    },
    locale?: UiLocale,
  ): Promise<ProviderSettings> {
    return settingsApi.upsertProviderConnection(this.http, token, connection, locale);
  }

  deleteProviderConnection(
    token: string,
    templateId: string,
    locale?: UiLocale,
  ): Promise<ProviderSettings> {
    return settingsApi.deleteProviderConnection(this.http, token, templateId, locale);
  }

  refreshProviderModels(
    token: string,
    templateId: string,
    locale?: UiLocale,
  ): Promise<ProviderSettings> {
    return settingsApi.refreshProviderModels(this.http, token, templateId, locale);
  }

  setProviderModelEnabled(
    token: string,
    ref: { templateId: string; modelId: string },
    enabled: boolean,
    locale?: UiLocale,
  ): Promise<ProviderSettings> {
    return settingsApi.setProviderModelEnabled(this.http, token, ref, enabled, locale);
  }

  setProviderActiveModel(
    token: string,
    ref: { templateId: string; modelId: string },
    locale?: UiLocale,
  ): Promise<ProviderSettings> {
    return settingsApi.setProviderActiveModel(this.http, token, ref, locale);
  }

  hydrateProviderRuntimeSecrets(token: string, secrets: Record<string, string>): Promise<void> {
    return settingsApi.hydrateProviderRuntimeSecrets(this.http, token, secrets);
  }

  preferences(token: string): Promise<UserPreferences> {
    return settingsApi.preferences(this.http, token);
  }

  savePreferences(token: string, update: PreferencesUpdate): Promise<UserPreferences> {
    return settingsApi.savePreferences(this.http, token, update);
  }

  userSkills(token: string, userId: string): Promise<UserSkill[]> {
    return settingsApi.userSkills(this.http, token, userId);
  }

  installUserSkill(
    token: string,
    userId: string,
    packagePath: string,
    expectName?: string,
  ): Promise<UserSkill> {
    return settingsApi.installUserSkill(this.http, token, userId, packagePath, expectName);
  }

  setUserSkillEnabled(token: string, userId: string, name: string, enabled: boolean): Promise<UserSkill> {
    return settingsApi.setUserSkillEnabled(this.http, token, userId, name, enabled);
  }

  deleteUserSkill(token: string, userId: string, name: string): Promise<void> {
    return settingsApi.deleteUserSkill(this.http, token, userId, name);
  }

  userMcp(token: string, userId: string): Promise<Record<string, unknown>> {
    return settingsApi.userMcp(this.http, token, userId);
  }

  saveUserMcp(token: string, userId: string, mcpServers: Record<string, unknown>): Promise<Record<string, unknown>> {
    return settingsApi.saveUserMcp(this.http, token, userId, mcpServers);
  }

  userAgentsMd(token: string, userId: string): Promise<string> {
    return settingsApi.userAgentsMd(this.http, token, userId);
  }

  saveUserAgentsMd(token: string, userId: string, content: string): Promise<string> {
    return settingsApi.saveUserAgentsMd(this.http, token, userId, content);
  }

  recruit(token: string, agentId: string): Promise<void> {
    return agentsApi.recruit(this.http, token, agentId);
  }

  dismiss(token: string, agentId: string, userId: string): Promise<void> {
    return agentsApi.dismiss(this.http, token, agentId, userId);
  }

  attention(token: string, userId: string): Promise<chatApi.AttentionSnapshot> {
    return chatApi.attention(this.http, token, userId);
  }

  decideApproval(
    token: string,
    approvalId: string,
    allow: boolean,
    scope: "once" | "session" | "agent" = "once",
  ): Promise<void> {
    return chatApi.decideApproval(this.http, token, approvalId, allow, scope);
  }

  answerAskUser(token: string, askUserId: string, answer: AskUserAnswer): Promise<void> {
    return chatApi.answerAskUser(this.http, token, askUserId, answer);
  }

  publish(
    token: string,
    agentDir: string,
    name: string,
    role: string,
    background: string,
    agentId?: string,
    rules = "",
  ): Promise<PublishedAgent> {
    return agentsApi.publish(this.http, token, agentDir, name, role, background, agentId, rules);
  }

  updateAgentCard(
    token: string,
    agentId: string,
    input: {
      name: string;
      role: string;
      background: string;
      rules?: string;
      avatarDataUrl?: string;
    },
  ): Promise<AgentCard> {
    return agentsApi.updateCard(this.http, token, agentId, input);
  }

  importPublishedLocal(token: string, userId: string, publishedAgentId: string): Promise<AgentCard> {
    return agentsApi.importPublishedLocal(this.http, token, userId, publishedAgentId);
  }

  exportPublishedSkill(
    token: string,
    agentId: string,
    skillName: string,
    destination: string,
  ): Promise<{ path: string }> {
    return agentsApi.exportPublishedSkill(this.http, token, agentId, skillName, destination);
  }

  inspectAgent(token: string, agentDir: string): Promise<AgentSourcePreview> {
    return agentsApi.inspectAgent(this.http, token, agentDir);
  }

  visitDirectory(token: string, agentId: string, userId: string): Promise<string> {
    return agentsApi.visitDirectory(this.http, token, agentId, userId);
  }

  invocableSkills(token: string, agentId: string, userId: string): Promise<InvocableSkill[]> {
    return chatApi.invocableSkills(this.http, token, agentId, userId);
  }

  stageAttachment(
    token: string,
    userId: string,
    agentId: string,
    file: { name: string; mediaType: string; dataBase64: string },
  ): Promise<StagedAttachment> {
    return attachmentsApi.stageAttachment(this.http, token, userId, agentId, file);
  }

  deleteStagedAttachment(
    token: string,
    userId: string,
    agentId: string,
    relativePath: string,
  ): Promise<void> {
    return attachmentsApi.deleteStagedAttachment(this.http, token, userId, agentId, relativePath);
  }

  history(token: string, agentId: string, userId: string): Promise<UIMessage[]> {
    return chatApi.history(this.http, token, agentId, userId);
  }

  sessionModel(
    token: string,
    agentId: string,
    userId: string,
    locale?: UiLocale,
  ): Promise<SessionModelState> {
    return chatApi.sessionModel(this.http, token, agentId, userId, locale);
  }

  setSessionModel(
    token: string,
    agentId: string,
    userId: string,
    ref: ProviderModelRef,
    locale?: UiLocale,
  ): Promise<SessionModelState> {
    return chatApi.setSessionModel(this.http, token, agentId, userId, ref, locale);
  }

  clearContext(token: string, agentId: string, userId: string): Promise<void> {
    return chatApi.clearContext(this.http, token, agentId, userId);
  }

  clearHistory(token: string, agentId: string, userId: string): Promise<void> {
    return chatApi.clearHistory(this.http, token, agentId, userId);
  }

  listDelegations(
    token: string,
    userId: string,
    options: { unseenOnly?: boolean } = {},
  ): Promise<chatApi.DelegationTaskDto[]> {
    return chatApi.listDelegations(this.http, token, userId, options);
  }

  acknowledgeDelegation(token: string, userId: string, taskId: string): Promise<void> {
    return chatApi.acknowledgeDelegation(this.http, token, userId, taskId);
  }

  delegationHistory(
    token: string,
    userId: string,
    taskId: string,
  ): Promise<chatApi.DelegationHistoryDto> {
    return chatApi.delegationHistory(this.http, token, userId, taskId);
  }

  sync(token: string, agentId: string, userId: string): Promise<SyncedVisit> {
    return agentsApi.sync(this.http, token, agentId, userId);
  }

  listWorkspace(
    token: string,
    userId: string,
    agentId: string,
    personal: boolean,
    directory: string,
  ): Promise<{ path: string; entries: WorkspaceEntry[] }> {
    return workspaceApi.listWorkspace(this.http, token, userId, agentId, personal, directory);
  }

  readWorkspaceFile(
    token: string,
    userId: string,
    agentId: string,
    personal: boolean,
    filePath: string,
  ): Promise<WorkspaceFile> {
    return workspaceApi.readWorkspaceFile(this.http, token, userId, agentId, personal, filePath);
  }

  writeWorkspaceText(
    token: string,
    userId: string,
    agentId: string,
    personal: boolean,
    filePath: string,
    text: string,
  ): Promise<void> {
    return workspaceApi.writeWorkspaceText(this.http, token, userId, agentId, personal, filePath, text);
  }

  createWorkspaceEntry(
    token: string,
    userId: string,
    agentId: string,
    personal: boolean,
    filePath: string,
    kind: "file" | "dir",
  ): Promise<void> {
    return workspaceApi.createWorkspaceEntry(this.http, token, userId, agentId, personal, filePath, kind);
  }

  renameWorkspaceEntry(
    token: string,
    userId: string,
    agentId: string,
    personal: boolean,
    filePath: string,
    name: string,
  ): Promise<string> {
    return workspaceApi.renameWorkspaceEntry(this.http, token, userId, agentId, personal, filePath, name);
  }

  deleteWorkspaceEntry(
    token: string,
    userId: string,
    agentId: string,
    personal: boolean,
    filePath: string,
  ): Promise<void> {
    return workspaceApi.deleteWorkspaceEntry(this.http, token, userId, agentId, personal, filePath);
  }

  resolveWorkspaceAbsolute(
    token: string,
    userId: string,
    agentId: string,
    personal: boolean,
    filePath: string,
  ): Promise<string> {
    return workspaceApi.resolveWorkspaceAbsolute(this.http, token, userId, agentId, personal, filePath);
  }
}
