export { ApprovalBroker } from "./broker.js";
export { createApprovalExtension } from "./extension.js";
export {
  CAPABILITY_BROWSER_USE,
  CAPABILITY_COMPUTER_USE,
  capabilityAllowKey,
  externalToolAllowKey,
  isCommandTool,
  isDelegationTool,
  isMcpTool,
  sdkToolAllowKey,
} from "./tools.js";
export type {
  ApprovalExtensionOptions,
  ApprovalRequest,
  ApprovalScope,
  ProjectMountContext,
} from "./types.js";
