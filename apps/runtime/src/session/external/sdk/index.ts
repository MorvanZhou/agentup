/** 多 SDK adaptor 层入口。文档：.cursor/skills/agentup-sdk-adapter/references/ */
export type {
  ExternalCompactRequest,
  ExternalDriver,
  ExternalDriverCapabilities,
  ExternalDriverId,
  ExternalTodoApplyResult,
  ExternalTodoBoard,
  ExternalTodoProjector,
  ExternalTurnRequest,
  ExternalTurnHandle,
  WorkerResult,
} from "./contract.js";
export {
  getExternalDriver,
  driverIdOfTemplate,
  listExternalDriverIds,
  installedCliPathFor,
} from "./registry.js";
export { queryExternalAgent } from "./host/turn-factory.js";
export { createAgentSdkStreamSimple } from "./host/stream-bridge.js";
export {
  transcriptToPrompt,
  feedMessagesFromBranch,
  CONTEXT_COMPACTION_CUSTOM_TYPE,
  MAX_PROMPT_CHARS,
} from "./host/prompt.js";
export { resultFromSdkMessage } from "./host/result.js";
export {
  AGENT_SDK_API,
  AGENT_SDK_RUNTIME_IDLE_MS,
  AGENT_SDK_TURN_TIMEOUT_MS,
  type AgentSdkStreamContext,
  type ExternalAgentQuery,
} from "./host/types.js";
export {
  acquireAgentSdkRuntime,
  agentSdkRuntimeKey,
  disposeAgentSdkRuntime,
  disposeAgentSdkRuntimesForTemplate,
  disposeAllAgentSdkRuntimes,
  releaseAgentSdkRuntime,
} from "./host/runtime-pool.js";
