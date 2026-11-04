/**
 * 本机服务商 / 模型配置（settings/provider.json）的对外入口。
 *
 * 原来是一个 1100+ 行的 provider.ts，按职责拆成：
 * - `constants.ts` 落盘版本与上限常量
 * - `types.ts` 对外类型与落盘结构
 * - `util.ts` 字符串 / 键 / 地址的小工具
 * - `secrets.ts` 内存明文密钥（永不落盘）
 * - `validate.ts` 落盘前的形状校验
 * - `store.ts` 读写 provider.json（含 v2 → v3 兼容）
 * - `env.ts` AGENTUP_MODEL_* 覆盖
 * - `agent-sdk-state.ts` 本地 CLI / SDK 接入的状态与目录
 * - `connections.ts` 服务商连接的增删改与模型发现
 * - `models.ts` 启用 / 激活 / 校验模型
 * - `model-config.ts` 解析成会话要用的 ModelConfig
 * - `settings-view.ts` 设置页整页视图
 *
 * 依赖方向是单向的（settings-view → agent-sdk-state → store → validate），不要反向引。
 */

export { supportsModelDiscovery } from "../discover-models.js";

export type {
  AgentSdkAuthEnvironment,
  AgentSdkModel,
  AgentSdkRecord,
  AgentSdkState,
  AgentSdkView,
  AvailableModelView,
  ModelRef,
  ProviderConnection,
  ProviderConnectionView,
  ProviderSettingsView,
} from "./types.js";

export { ProviderSecretPendingError } from "./secrets.js";
export {
  clearRuntimeProviderSecrets,
  onRuntimeProviderSecrets,
  setRuntimeProviderSecrets,
} from "./secrets.js";

export { readProviderSettings } from "./settings-view.js";

export {
  agentSdkAccountLabel,
  agentSdkAuthEnvironment,
  agentSdkModels,
  agentSdkStateOf,
  setAgentSdkAccountLabel,
  setAgentSdkAuthEnvironment,
  setAgentSdkModels,
  setAgentSdkState,
} from "./agent-sdk-state.js";

export {
  deleteProviderConnection,
  refreshProviderModels,
  removeCustomModel,
  upsertProviderConnection,
} from "./connections.js";

export {
  firstEnabledModelRef,
  requireEnabledModelRef,
  setActiveModel,
  setModelEnabled,
  touchActiveModel,
  tryEnabledModelRef,
} from "./models.js";

export { loadModelConfig, loadModelConfigFromRef } from "./model-config.js";
