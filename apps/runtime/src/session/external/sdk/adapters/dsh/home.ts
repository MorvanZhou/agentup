import fs from "node:fs";
import path from "node:path";

import { agentSdkDir } from "../../../../../config/providers/agent-sdk/installer.js";

/**
 * 隔离 DSH_HOME；绝不发现 ~/.dsh。
 * API Key 落盘在 home 内明文 JSON（与 Copilot / Codex 同策略）——勿进 git / 日志。
 */

const TOKEN_FILE = "agentup-deepseek-api-key.json";

export function dshHomeDir(userDataRoot: string, templateId: string): string {
  return path.join(agentSdkDir(userDataRoot, templateId), "dsh-home");
}

export function ensureDshHome(userDataRoot: string, templateId: string): string {
  const home = dshHomeDir(userDataRoot, templateId);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  return home;
}

function tokenPath(userDataRoot: string, templateId: string): string {
  return path.join(dshHomeDir(userDataRoot, templateId), TOKEN_FILE);
}

/** 读出自管 DeepSeek API Key；失败返回 null。 */
export function readDshApiKey(userDataRoot: string, templateId: string): string | null {
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

export function hasDshApiKey(userDataRoot: string, templateId: string): boolean {
  return Boolean(readDshApiKey(userDataRoot, templateId));
}

export function writeDshApiKey(
  userDataRoot: string,
  templateId: string,
  apiKey: string,
  accountLabel?: string | null,
): void {
  ensureDshHome(userDataRoot, templateId);
  const file = tokenPath(userDataRoot, templateId);
  const row: Record<string, string> = { api_key: apiKey.trim() };
  if (accountLabel?.trim()) row.account_label = accountLabel.trim();
  fs.writeFileSync(file, `${JSON.stringify(row, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function clearDshApiKey(userDataRoot: string, templateId: string): void {
  const file = tokenPath(userDataRoot, templateId);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* 清不掉下次当未登录 */
  }
}

/** 展示用账号标签（不返回 Key）。 */
export function readDshAccountLabel(
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
