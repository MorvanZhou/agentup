/**
 * 薄委托：厂商装载在 session/external/sdk/adapters/<driverId>/load。
 * 设置页与旧测例仍从本路径 import。
 */
export {
  loadAgentSdkModule,
  loadCodebuddyModule,
  installedCliPath,
  withTimeout,
  type AgentSdkModule,
  type AgentSdkQuery,
  type AgentSdkSession,
} from "../../../session/external/sdk/adapters/codebuddy/index.js";
