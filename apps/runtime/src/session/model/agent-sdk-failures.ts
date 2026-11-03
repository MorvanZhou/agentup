/** 失败分类已迁至 session/external/sdk/host/failures；本文件保持旧 import 路径。 */
export {
  markAgentSdkFailure,
  isAgentSdkFailure,
  agentSdkFailureNotice,
  classifyAgentSdkFailure,
  scrubSecrets,
  type AgentSdkFailureCode,
} from "../external/sdk/host/failures.js";
