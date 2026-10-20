/** 控制面 HTTP 客户端：薄 barrel，保持既有 `control/client.js` import。 */

export { BackendClientError } from "./errors.js";
export type {
  AgentCard,
  AgentListQuery,
  PreferencesUpdate,
  PublishedAgent,
  Recruit,
  RegisterPending,
  SessionCredential,
  ThemeMode,
  UiLocale,
  UserPreferences,
} from "./types.js";
export {
  forgotPassword,
  login,
  oauthAuthorizeUrl,
  oauthExchange,
  registerAccount,
  resendVerification,
  resetPassword,
  turnstilePublic,
  updateProfile,
  verifyEmail,
} from "./auth-api.js";
export {
  listAgents,
  listOwnedAgents,
  listPublicAgents,
  publishAgent,
  recruitAgent,
  setAgentRemark,
  unrecruitAgent,
} from "./agents-api.js";
export { getPreferences, putPreferences } from "./preferences-api.js";
export { HttpPackageSource } from "./package-source.js";
