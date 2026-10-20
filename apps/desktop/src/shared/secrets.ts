/** 经主进程 safeStorage 加解密；无 Electron 桥时仅开发/测试用可逆占位。 */

export async function secretEncryptionReady(): Promise<boolean> {
  const api = window.agentUp;
  if (api?.secretEncryptionReady) return api.secretEncryptionReady();
  return import.meta.env.DEV;
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const api = window.agentUp;
  if (api?.encryptSecret) return api.encryptSecret(plaintext);
  if (!import.meta.env.DEV) throw new Error("本机无法安全保存密钥");
  return `dev:${btoa(unescape(encodeURIComponent(plaintext)))}`;
}

export async function decryptSecret(cipher: string): Promise<string> {
  const api = window.agentUp;
  if (api?.decryptSecret) return api.decryptSecret(cipher);
  if (!import.meta.env.DEV || !cipher.startsWith("dev:")) {
    throw new Error("本机无法安全读取密钥");
  }
  return decodeURIComponent(escape(atob(cipher.slice(4))));
}
