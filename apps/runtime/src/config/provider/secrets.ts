import { ConfigError } from "../load.js";
import { PLACEHOLDER_KEY } from "./constants.js";
import type { ProviderConnection } from "./types.js";

/**
 * 密文已落盘，但本进程还没收到桌面解密后的明文。
 * 退出重进时 runtime 先起来、密钥稍后才注入；这不是密钥丢了。
 */
export class ProviderSecretPendingError extends ConfigError {
  constructor() {
    super("模型密钥还在载入，请稍后再试");
  }
}

/** 明文 Key 只留在进程内存，key = templateId。 */
const runtimeSecrets = new Map<string, string>();
const secretReadyListeners = new Set<() => void>();

/** 桌面把明文注入内存后通知。用于把退出时中断的回合接上，而不是先报缺密钥。 */
export function onRuntimeProviderSecrets(listener: () => void): () => void {
  secretReadyListeners.add(listener);
  return () => {
    secretReadyListeners.delete(listener);
  };
}

export function setRuntimeProviderSecrets(secrets: Record<string, string>): void {
  let added = false;
  for (const [templateId, apiKey] of Object.entries(secrets)) {
    const key = apiKey.trim();
    if (!templateId.trim()) continue;
    if (!key) {
      runtimeSecrets.delete(templateId);
      continue;
    }
    runtimeSecrets.set(templateId, key);
    added = true;
  }
  if (!added) return;
  for (const listener of secretReadyListeners) {
    try {
      listener();
    } catch {
      // 某一个等待方失败不挡住其余回合。
    }
  }
}

export function clearRuntimeProviderSecrets(): void {
  runtimeSecrets.clear();
}

/** 内存里是否已有明文；设置页用它判断「已填密钥」。 */
export function hasRuntimeApiKey(templateId: string): boolean {
  return Boolean(runtimeSecrets.get(templateId));
}

/** 清密钥 / 删连接时同步丢掉内存明文。 */
export function dropRuntimeApiKey(templateId: string): void {
  runtimeSecrets.delete(templateId);
}

/** 要密钥的服务商：内存里有明文才可用。盘上有密文只说明还没注入，不是密钥丢了。 */
export function runtimeApiKey(
  template: { id: string; requiresApiKey: boolean },
  connection: ProviderConnection,
): string {
  if (!template.requiresApiKey) return runtimeSecrets.get(template.id) || PLACEHOLDER_KEY;
  const key = runtimeSecrets.get(template.id) ?? "";
  if (key) return key;
  if (connection.apiKeyCipher) throw new ProviderSecretPendingError();
  throw new ConfigError("当前服务商缺少 API Key，请重新保存密钥");
}
