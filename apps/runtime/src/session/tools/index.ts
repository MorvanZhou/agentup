/** Extension `registerTool` 工具：新增能力时在本目录加文件，并在此再导出。 */

export { formatToolsUsagePrompt } from "./usage-prompt.js";

export {
  GET_LOCAL_TIME_TOOL,
  createLocalTimeExtension,
  formatLocalTime,
  readLocalTime,
  type LocalTimeInfo,
} from "./local-time.js";

export {
  ASK_USER_TOOL,
  AskUserBroker,
  createAskUserExtension,
  parseAskUserAnswer,
  type AskUserAnswer,
  type AskUserItemAnswer,
  type AskUserOption,
  type AskUserQuestion,
  type AskUserRequest,
} from "./ask-user.js";

export {
  TODO_TOOL,
  applyTodoAction,
  createTodoExtension,
  emptyTodoState,
  formatTodoList,
  todoStateFromEntries,
  type TodoAction,
  type TodoItem,
  type TodoState,
} from "./todo.js";

export {
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  assertPublicHttpUrl,
  createWebToolsExtension,
  fetchPublicUrl,
  parseDuckDuckGoLiteHtml,
  searchWeb,
  type WebSearchHit,
} from "./web.js";

export {
  CANCEL_DELEGATION_TOOL,
  CHECK_DELEGATION_TOOL,
  STEER_DELEGATION_TOOL,
  RESOLVE_DELEGATION_UPDATE_TOOL,
  DELEGATE_TO_AGENT_TOOL,
  AGENT_SEARCH_TOOL,
  createDelegateExtension,
} from "./delegate.js";

export {
  AGENTUP_ARTIFACT_CONFIRM_TYPE,
  DELIVER_ARTIFACTS_TOOL,
  buildArtifactConfirmPrompt,
  candidateArtifactPaths,
  copyStagedArtifactsToParent,
  createDelegationInboxExtension,
  createDeliverArtifactsExtension,
  normalizeArtifactPaths,
  shouldForceArtifactConfirm,
  stageArtifactPaths,
  type DeliverArtifactsState,
  type StagedArtifact,
} from "./deliver-artifacts.js";

export {
  BG_KILL_TOOL,
  BG_RUN_TOOL,
  BG_STATUS_TOOL,
  createBackgroundJobsExtension,
} from "./background.js";

export { createFsGuardExtension } from "./fs-guard.js";
