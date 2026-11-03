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
  DEFAULT_RECENT_TURNS,
  type TranscriptPromptOptions,
} from "../external/sdk/host/prompt.js";
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
