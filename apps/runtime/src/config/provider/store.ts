import fs from "node:fs";
import path from "node:path";

import { ConfigError } from "../load.js";
import { FILE_VERSION } from "./constants.js";
import type { AgentSdkRecord, ModelRef, ProviderConnection, StoredFile } from "./types.js";
import { validateAgentSdkRecord, validateConnection, validateModelRef } from "./validate.js";

/** 没有档案 / 档案不可读时的空档；v1 结构也走这里重新开始。 */
export function emptyStored(): StoredFile {
  return {
    version: FILE_VERSION,
    connections: [],
    enabledModels: [],
    activeModel: null,
    agentSdks: [],
  };
}

/** 读 settings/provider.json；v2 / v3 可读，v1 丢弃，坏档报错。 */
export function readStored(userDataRoot: string): StoredFile {
  const file = path.join(userDataRoot, "settings", "provider.json");
  if (!fs.existsSync(file)) return emptyStored();
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    // v3 起带本地 SDK 状态；v2 没有该字段，按「都没装」补齐
    if ((raw.version === 2 || raw.version === 3) && Array.isArray(raw.connections)) {
      const connections = (raw.connections as ProviderConnection[]).map(validateConnection);
      // 先读本地 SDK 状态：启用模型里可能有本地接入的模型，校验时要用得上
      const agentSdks = Array.isArray(raw.agentSdks)
        ? (raw.agentSdks as AgentSdkRecord[])
            .map((item) => validateAgentSdkRecord(item))
            .filter((item): item is AgentSdkRecord => Boolean(item))
        : [];
      const partial: StoredFile = {
        version: FILE_VERSION,
        connections,
        enabledModels: [],
        activeModel: null,
        agentSdks,
      };
      const enabledModels = Array.isArray(raw.enabledModels)
        ? (raw.enabledModels as ModelRef[])
            .map((item) => {
              try {
                return validateModelRef(item, partial);
              } catch {
                return null;
              }
            })
            .filter((item): item is ModelRef => Boolean(item))
        : [];
      let activeModel: ModelRef | null = null;
      if (raw.activeModel && typeof raw.activeModel === "object") {
        try {
          activeModel = validateModelRef(raw.activeModel as ModelRef, partial);
        } catch {
          activeModel = enabledModels[0] ?? null;
        }
      }
      return { version: FILE_VERSION, connections, enabledModels, activeModel, agentSdks };
    }
    // v1 档案结构丢弃，重新配置
    return emptyStored();
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("本机 AI 服务配置无法读取");
  }
}

/** tmp + rename 原子写，0o600；顺手清掉旧版 model.json。 */
export function persist(userDataRoot: string, value: StoredFile): void {
  const directory = path.join(userDataRoot, "settings");
  const target = path.join(directory, "provider.json");
  const temporary = `${target}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  try {
    const legacy = path.join(directory, "model.json");
    if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
  } catch {
    /* ignore */
  }
}

/** 在既有档上改一部分字段写回；version 恒定为当前版本。 */
export function patchStored(
  userDataRoot: string,
  stored: StoredFile,
  patch: Partial<StoredFile>,
): void {
  persist(userDataRoot, { ...stored, ...patch, version: FILE_VERSION });
}
