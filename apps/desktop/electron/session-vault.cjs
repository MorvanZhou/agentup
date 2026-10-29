/**
 * 用 Electron safeStorage 把登录态密文落在 userData。
 * 不写业务逻辑，只做加解密与文件读写。
 */
function createSessionVault({ safeStorage, userDataPath, fs, path }) {
  const filePath = path.join(userDataPath, "session.enc");

  function encryptionReady() {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (typeof safeStorage.getSelectedStorageBackend === "function" && safeStorage.getSelectedStorageBackend() === "basic_text") {
      return false;
    }
    return true;
  }

  function parseSession(raw) {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.userId !== "string" ||
      typeof parsed?.email !== "string" ||
      typeof parsed?.nickname !== "string" ||
      typeof parsed?.token !== "string" ||
      !parsed.userId ||
      !parsed.nickname ||
      !parsed.token
    ) {
      return null;
    }
    const kind = parsed.kind === "guest" || parsed.userId === "guest" ? "guest" : "account";
    if (kind === "account" && !parsed.email) return null;
    // 与 renderer session-store 对齐：头像字段一并落盘，避免重启丢 URL。
    const hasAvatar = parsed.hasAvatar === true;
    const avatarUrl =
      typeof parsed.avatarUrl === "string" && parsed.avatarUrl.trim()
        ? parsed.avatarUrl.trim()
        : undefined;
    return {
      kind,
      userId: parsed.userId,
      email: parsed.email,
      nickname: parsed.nickname,
      token: parsed.token,
      ...(hasAvatar ? { hasAvatar: true } : {}),
      ...(hasAvatar && avatarUrl ? { avatarUrl } : {}),
    };
  }

  async function read() {
    if (!encryptionReady()) return null;
    let encoded;
    try {
      encoded = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
    try {
      return parseSession(safeStorage.decryptString(Buffer.from(encoded, "base64")));
    } catch {
      return null;
    }
  }

  async function write(session) {
    if (!encryptionReady()) throw new Error("本机无法安全保存登录态");
    const next = parseSession(JSON.stringify(session ?? {}));
    if (!next) throw new Error("登录态无效");
    const encrypted = safeStorage.encryptString(JSON.stringify(next));
    await fs.mkdir(userDataPath, { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, encrypted.toString("base64"), "utf8");
    await fs.rename(tmp, filePath);
  }

  async function clear() {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
  }

  return { read, write, clear, encryptionReady };
}

module.exports = { createSessionVault };
