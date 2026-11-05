import fs from "node:fs";
import path from "node:path";

import { agentSdkDir } from "../../../../../config/providers/agent-sdk/installer.js";

/**
 * 隔离 CLAUDE_CONFIG_DIR；绝不发现 ~/.claude。
 * API Key 落盘在 home 内明文 JSON（与 Copilot / dsh 同策略）——勿进 git / 日志。
 */

const TOKEN_FILE = "agentup-anthropic-api-key.json";

export function claudeHomeDir(userDataRoot: string, templateId: string): string {
  return path.join(agentSdkDir(userDataRoot, templateId), "claude-home");
}

export function ensureClaudeHome(userDataRoot: string, templateId: string): string {
  const home = claudeHomeDir(userDataRoot, templateId);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  return home;
}

function tokenPath(userDataRoot: string, templateId: string): string {
  return path.join(claudeHomeDir(userDataRoot, templateId), TOKEN_FILE);
}

/** 读出自管 Anthropic API Key；失败返回 null。 */
export function readClaudeApiKey(userDataRoot: string, templateId: string): string | null {
  const file = tokenPath(userDataRoot, templateId);
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { api_key?: unknown };
    const key = typeof parsed.api_key === "string" ? parsed.api_key.trim() : "";
    return key || null;
  } catch {
    return null;
  }
}

export function hasClaudeApiKey(userDataRoot: string, templateId: string): boolean {
  return Boolean(readClaudeApiKey(userDataRoot, templateId));
}

export function writeClaudeApiKey(
  userDataRoot: string,
  templateId: string,
  apiKey: string,
  accountLabel?: string | null,
): void {
  ensureClaudeHome(userDataRoot, templateId);
  const file = tokenPath(userDataRoot, templateId);
  const row: Record<string, string> = { api_key: apiKey.trim() };
  if (accountLabel?.trim()) row.account_label = accountLabel.trim();
  fs.writeFileSync(file, `${JSON.stringify(row, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function clearClaudeApiKey(userDataRoot: string, templateId: string): void {
  const file = tokenPath(userDataRoot, templateId);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* 清不掉下次当未登录 */
  }
}

/** 展示用账号标签（不返回 Key）。 */
export function readClaudeAccountLabel(
  userDataRoot: string,
  templateId: string,
): string | null {
  const file = tokenPath(userDataRoot, templateId);
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      account_label?: unknown;
    };
    const label =
      typeof parsed.account_label === "string" ? parsed.account_label.trim() : "";
    return label || null;
  } catch {
    return null;
  }
}
