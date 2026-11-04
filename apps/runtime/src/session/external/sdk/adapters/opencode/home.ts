import fs from "node:fs";
import path from "node:path";

import { agentSdkDir } from "../../../../../config/providers/agent-sdk/installer.js";

/**
 * OpenCode 状态必须留在 AgentUp 自管目录；绝不读取用户的
 * ~/.local/share/opencode 或全局配置目录。
 */
export function opencodeHomeDir(userDataRoot: string, templateId: string): string {
  return path.join(agentSdkDir(userDataRoot, templateId), "opencode-home");
}

export function ensureHome(userDataRoot: string, templateId: string): string {
  const home = opencodeHomeDir(userDataRoot, templateId);
  for (const dir of [
    home,
    path.join(home, "data"),
    path.join(home, "xdg-data"),
    path.join(home, "config"),
  ]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return home;
}

export function opencodeAuthPaths(userDataRoot: string, templateId: string): string[] {
  const home = opencodeHomeDir(userDataRoot, templateId);
  return [
    path.join(home, "data", "auth.json"),
    path.join(home, "xdg-data", "opencode", "auth.json"),
  ];
}

export function hasOpencodeAuth(userDataRoot: string, templateId: string): boolean {
  return readOpencodeCredential(userDataRoot, templateId) !== null;
}

export function accountLabel(userDataRoot: string, templateId: string): string | null {
  const credential = readOpencodeCredential(userDataRoot, templateId);
  if (!credential) return null;
  const metadata = credential.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const row = metadata as Record<string, unknown>;
    for (const field of ["email", "account", "organization"]) {
      const value = row[field];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  // 只展示凭据类型，绝不把 key / access token 带进日志或设置页。
  return credential.type === "oauth" ? "OpenCode OAuth" : "OpenCode";
}

export function clearAuth(userDataRoot: string, templateId: string): void {
  for (const file of opencodeAuthPaths(userDataRoot, templateId)) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* 清理失败时 probe 仍按实际文件判定。 */
    }
  }
}

function readOpencodeCredential(
  userDataRoot: string,
  templateId: string,
): Record<string, unknown> | null {
  for (const file of opencodeAuthPaths(userDataRoot, templateId)) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const credential = (parsed as Record<string, unknown>).opencode;
      if (!credential || typeof credential !== "object" || Array.isArray(credential)) continue;
      const row = credential as Record<string, unknown>;
      if (
        (row.type === "api" && typeof row.key === "string" && row.key.trim()) ||
        (row.type === "oauth" && typeof row.access === "string" && row.access.trim())
      ) {
        return row;
      }
    } catch {
      /* 坏文件视为未登录。 */
    }
  }
  return null;
}
