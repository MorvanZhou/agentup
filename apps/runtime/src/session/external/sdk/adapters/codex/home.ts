import fs from "node:fs";
import path from "node:path";

import { agentSdkDir } from "../../../../../config/providers/agent-sdk/installer.js";

/**
 * 隔离 CODEX_HOME：不写用户本机 ~/.codex，避免污染 CLI 全局登录。
 * 凭证在 auth.json（明文，与官方 CLI 同形）——勿进 git / 日志。
 */

export function codexHomeDir(userDataRoot: string, templateId: string): string {
  return path.join(agentSdkDir(userDataRoot, templateId), "codex-home");
}

export function codexAuthPath(userDataRoot: string, templateId: string): string {
  return path.join(codexHomeDir(userDataRoot, templateId), "auth.json");
}

export function ensureCodexHome(userDataRoot: string, templateId: string): string {
  const home = codexHomeDir(userDataRoot, templateId);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  return home;
}

/** 是否已有 ChatGPT / token 登录痕迹（不解析 token 内容）。 */
export function hasCodexAuth(userDataRoot: string, templateId: string): boolean {
  const file = codexAuthPath(userDataRoot, templateId);
  try {
    if (!fs.existsSync(file)) return false;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    if (parsed.tokens && typeof parsed.tokens === "object") return true;
    if (typeof parsed.OPENAI_API_KEY === "string" && parsed.OPENAI_API_KEY.trim()) return true;
    return false;
  } catch {
    return false;
  }
}

/** 从 auth.json 抽展示用账号标签（邮箱 / account_id）；绝不返回 token。 */
export function readCodexAccountLabel(
  userDataRoot: string,
  templateId: string,
): string | null {
  const file = codexAuthPath(userDataRoot, templateId);
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const tokens = parsed.tokens;
    if (tokens && typeof tokens === "object" && !Array.isArray(tokens)) {
      const row = tokens as Record<string, unknown>;
      const accountId = typeof row.account_id === "string" ? row.account_id.trim() : "";
      if (accountId) return accountId;
    }
    const email = typeof parsed.email === "string" ? parsed.email.trim() : "";
    return email || null;
  } catch {
    return null;
  }
}

export function clearCodexHomeAuth(userDataRoot: string, templateId: string): void {
  const file = codexAuthPath(userDataRoot, templateId);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* 清不掉下次当未登录 */
  }
}
