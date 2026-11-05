/**
 * Claude Code（Agent SDK）adaptor（driverId: claude-code）。
 * 同构 query + systemPrompt preset/append + AskUserQuestion；登录为 Console API Key。
 */
export { claudeCodeDriver } from "./driver.js";
export {
  loadClaudeModule,
  resolveClaudeCliPath,
  withTimeout,
  type ClaudeAgentSdkModule,
  type ClaudeQuery,
} from "./load.js";
export {
  claudeHomeDir,
  clearClaudeApiKey,
  ensureClaudeHome,
  hasClaudeApiKey,
  readClaudeApiKey,
  writeClaudeApiKey,
} from "./home.js";
export {
  CLAUDE_API_KEY_PAGE,
  CLAUDE_MODELS_UNAVAILABLE,
  checkClaudeLogin,
  ensureClaudeModels,
  fetchClaudeModels,
  logoutClaude,
  refreshClaudeModels,
  startClaudeLogin,
  submitClaudeApiKey,
  type LoginResult,
} from "./lifecycle.js";
export { normalizeAnthropicModels } from "./models-api.js";
export { claudeCompactOptionsOf, claudeOptionsOf } from "./options.js";
