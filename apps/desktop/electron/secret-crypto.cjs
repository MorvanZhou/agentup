/**
 * Electron safeStorage 薄封装：只做字符串加解密，不写业务逻辑。
 */
function createSecretCrypto({ safeStorage }) {
  function encryptionReady() {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (
      typeof safeStorage.getSelectedStorageBackend === "function" &&
      safeStorage.getSelectedStorageBackend() === "basic_text"
    ) {
      return false;
    }
    return true;
  }

  function encrypt(plaintext) {
    if (typeof plaintext !== "string") throw new Error("明文无效");
    if (!encryptionReady()) throw new Error("本机无法安全保存密钥");
    return safeStorage.encryptString(plaintext).toString("base64");
  }

  function decrypt(cipher) {
    if (typeof cipher !== "string" || !cipher.trim()) throw new Error("密文无效");
    if (!encryptionReady()) throw new Error("本机无法安全读取密钥");
    try {
      return safeStorage.decryptString(Buffer.from(cipher, "base64"));
    } catch {
      throw new Error("密钥密文无法解密");
    }
  }

  return { encryptionReady, encrypt, decrypt };
}

module.exports = { createSecretCrypto };
