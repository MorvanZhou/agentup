/** provider.json 落盘结构版本；改动前先看 docs/agent_cli 的兼容要求（旧档必须还能读）。 */
export const FILE_VERSION = 3 as const;

/** 不需要密钥的服务商（Ollama 等）也要给 pi 一个非空 key。 */
export const PLACEHOLDER_KEY = "ollama";

/** 单次刷新最多记多少个从服务商 List Models 拉回的 id。 */
export const MAX_DISCOVERED_MODELS = 200;

/** 本地 SDK 查回来的模型目录上限。 */
export const MAX_AGENT_SDK_MODELS = 200;
