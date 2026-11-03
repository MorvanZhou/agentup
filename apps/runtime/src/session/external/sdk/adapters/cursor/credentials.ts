import fs from "node:fs";
import path from "node:path";

import { agentSdkDir } from "../../../../../config/providers/agent-sdk/installer.js";
import type { CursorCredentialStore, CursorStoredCredentials } from "./load.js";

/**
 * 自管凭据文件（安装目录内），不依赖 SDK 是否导出 FileCredentialStore 构造器。
 * 形状对齐 SdkCredentialStore，可直接传给 Cursor.auth.login({ store })。
 */

export function cursorAuthPath(userDataRoot: string, templateId: string): string {
  return path.join(agentSdkDir(userDataRoot, templateId), "cursor-auth.json");
}

export function cursorCredentialStore(
  userDataRoot: string,
  templateId: string,
): CursorCredentialStore {
  return new ManagedCursorCredentialStore(cursorAuthPath(userDataRoot, templateId));
}

export async function readCursorApiKey(
  userDataRoot: string,
  templateId: string,
): Promise<string | null> {
  const store = cursorCredentialStore(userDataRoot, templateId);
  const credentials = await store.load();
  const key = credentials?.apiKey?.trim();
  if (!key) return null;
  if (credentials?.apiKeyExpiresAtMs && credentials.apiKeyExpiresAtMs <= Date.now()) {
    await store.clear().catch(() => undefined);
    return null;
  }
  return key;
}

class ManagedCursorCredentialStore implements CursorCredentialStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<CursorStoredCredentials | null> {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as unknown;
      return parseCredentials(parsed);
    } catch {
      return null;
    }
  }

  async save(credentials: CursorStoredCredentials): Promise<void> {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      /* Windows 等可能无 chmod */
    }
  }

  async clear(): Promise<void> {
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    } catch {
      /* 清不掉下次 load 当未登录 */
    }
  }
}

function parseCredentials(value: unknown): CursorStoredCredentials | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.version !== 1) return null;
  const apiKey = typeof row.apiKey === "string" ? row.apiKey.trim() : "";
  const backendUrl = typeof row.backendUrl === "string" ? row.backendUrl.trim() : "";
  if (!apiKey || !backendUrl) return null;
  const createdAtMs =
    typeof row.createdAtMs === "number" && Number.isFinite(row.createdAtMs)
      ? row.createdAtMs
      : Date.now();
  return {
    version: 1,
    backendUrl,
    apiKey,
    createdAtMs,
    ...(typeof row.apiKeyExpiresAtMs === "number" ? { apiKeyExpiresAtMs: row.apiKeyExpiresAtMs } : {}),
    ...(typeof row.email === "string" && row.email.trim() ? { email: row.email.trim() } : {}),
  };
}
