/**
 * 兼容门面：实现已拆到 session/external/sdk/。
 * 新代码优先从 sdk/host 与 sdk/adapters 直接 import。
 * 文档：.cursor/skills/agentup-sdk-adapter/references/
 */

export type { WorkerResult } from "../external/sdk/contract.js";
export type { SdkMessage } from "../external/sdk/host/result.js";
export {
  AGENT_SDK_API,
  AGENT_SDK_TURN_TIMEOUT_MS,
  type AgentSdkApprovalSink,
  type AgentSdkAskUserSink,
  type AgentSdkStreamContext,
  type ExternalAgentQuery,
} from "../external/sdk/host/types.js";
export {
  transcriptToPrompt,
  feedMessagesFromBranch,
  estimateFeedChars,
  shouldCompactFeed,
  CONTEXT_COMPACTION_CUSTOM_TYPE,
  CONTEXT_COMPACTION_PREFIX,
  MAX_PROMPT_CHARS,
  DEFAULT_RECENT_TURNS,
  type TranscriptPromptOptions,
} from "../external/sdk/host/prompt.js";
export {
  appendContextCompaction,
  maybeCompactBranch,
  maybeCompactApiBranch,
  resolveApiKeepRecentTokens,
} from "../external/sdk/host/compact.js";
export {
  createCompactSummarize,
  pickApiModelConfig,
  resolveApiModelConfig,
  isOpenAiCompatApiModel,
  summarizeViaOpenAiCompat,
  summarizeViaModelRuntime,
  summarizeViaApiModel,
} from "../external/sdk/host/summarize.js";
export {
  createSdkCompactSummarize,
  clipTranscriptForCompact,
  buildCompactPrompt,
  pickSdkCompactTarget,
  COMPACT_INPUT_WINDOW_RATIO,
} from "../external/sdk/host/compact-sdk.js";
export {
  compactBudgetsFromContextWindow,
  resolveContextWindowTokens,
  COMPACT_TRIGGER_RATIO,
  COMPACT_HARD_TRUNCATE_RATIO,
  CHARS_PER_TOKEN_ESTIMATE,
} from "../external/sdk/host/budget.js";
export {
  compactTurnOptions,
  maybeCompactApiSession,
} from "../external/sdk/host/compact-turn.js";
export { resultFromSdkMessage } from "../external/sdk/host/result.js";
export {
  createAgentSdkStreamSimple,
  type AgentSdkStreamSimple,
} from "../external/sdk/host/stream-bridge.js";
export { queryExternalAgent } from "../external/sdk/host/turn-factory.js";
export {
  openExternalMcp,
  type OpenedExternalMcp,
} from "../external/sdk/host/mcp.js";
