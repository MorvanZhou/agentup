import fs from "node:fs";
import path from "node:path";

import { agentSdkDir } from "../../../../../config/providers/agent-sdk/installer.js";

/**
 * 隔离 COPILOT_HOME（= CopilotClient.baseDirectory）。
 * Token 落盘在 home 内明文 JSON（与 Codex auth.json 同策略）——勿进 git / 日志。
 *
 * 说明：官方 SDK 尚无一等 LoginAsync（github/copilot-sdk#1109）；
 * 捆绑的 copilot-runtime 也不接受 `login` 子命令 → 用自管 token / 本机已登录凭据。
 */

const TOKEN_FILE = "agentup-github-token.json";

export function copilotHomeDir(userDataRoot: string, templateId: string): string {
  return path.join(agentSdkDir(userDataRoot, templateId), "copilot-home");
}

export function ensureCopilotHome(userDataRoot: string, templateId: string): string {
  const home = copilotHomeDir(userDataRoot, templateId);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  return home;
}

function tokenPath(userDataRoot: string, templateId: string): string {
  return path.join(copilotHomeDir(userDataRoot, templateId), TOKEN_FILE);
}

/** 读出自管 GitHub token；失败返回 null。 */
export function readCopilotGithubToken(
  userDataRoot: string,
  templateId: string,
): string | null {
  const file = tokenPath(userDataRoot, templateId);
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { token?: unknown };
    const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
    return token || null;
  } catch {
    return null;
  }
}

export function hasCopilotToken(userDataRoot: string, templateId: string): boolean {
  return Boolean(readCopilotGithubToken(userDataRoot, templateId));
}

export function writeCopilotGithubToken(
  userDataRoot: string,
  templateId: string,
  token: string,
  accountLabel?: string | null,
): void {
  ensureCopilotHome(userDataRoot, templateId);
  const file = tokenPath(userDataRoot, templateId);
  const row: Record<string, string> = { token: token.trim() };
  if (accountLabel?.trim()) row.account_label = accountLabel.trim();
  fs.writeFileSync(file, `${JSON.stringify(row, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function clearCopilotGithubToken(userDataRoot: string, templateId: string): void {
  const file = tokenPath(userDataRoot, templateId);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* 清不掉下次当未登录 */
  }
}

/** 展示用账号标签（不返回 token）。 */
export function readCopilotAccountLabel(
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
