/**
 * 按模板 driverId 分发登录；设置页仍只认本文件的 API 形状。
 */
import { ConfigError } from "../../load.js";
import { getProviderTemplate } from "../../provider-templates.js";
import type { AgentSdkAuthEnvironment } from "../../provider/types.js";
import { disposeAgentSdkRuntimesForTemplate } from "../../../session/external/sdk/host/runtime-pool.js";
import {
  checkAgentSdkLogin as checkCodebuddyLogin,
  logoutAgentSdk as logoutCodebuddy,
  startAgentSdkLogin as startCodebuddyLogin,
  type LoginResult,
} from "../../../session/external/sdk/adapters/codebuddy/index.js";
import {
  checkCodexLogin,
  logoutCodex,
  startCodexLogin,
} from "../../../session/external/sdk/adapters/codex/index.js";
import {
  checkCursorLogin,
  logoutCursor,
  startCursorLogin,
} from "../../../session/external/sdk/adapters/cursor/index.js";
import {
  checkCopilotLogin,
  logoutCopilot,
  startCopilotLogin,
  submitCopilotApiKey,
} from "../../../session/external/sdk/adapters/copilot/index.js";
import {
  checkDshLogin,
  logoutDsh,
  startDshLogin,
  submitDshApiKey,
} from "../../../session/external/sdk/adapters/dsh/index.js";
import {
  checkOpencodeLogin,
  logoutOpencode,
  startOpencodeLogin,
  submitOpencodeApiKey,
} from "../../../session/external/sdk/adapters/opencode/index.js";

export type { LoginResult };

export interface AgentSdkLoginRequest {
  /** CodeBuddy：中国站 internal / 国际站 external；其它 driver 忽略 */
  environment?: AgentSdkAuthEnvironment;
}

function driverIdOf(templateId: string): string {
  const profile = getProviderTemplate(templateId)?.agentSdk;
  if (!profile?.driverId) throw new ConfigError("该接入方式不支持本地调用");
  return profile.driverId;
}

export async function startAgentSdkLogin(
  userDataRoot: string,
  templateId: string,
  request: AgentSdkLoginRequest = {},
): Promise<LoginResult> {
  const driverId = driverIdOf(templateId);
  if (driverId === "cursor") return startCursorLogin(userDataRoot, templateId);
  if (driverId === "codex") return startCodexLogin(userDataRoot, templateId);
  if (driverId === "opencode") return startOpencodeLogin(userDataRoot, templateId);
  if (driverId === "copilot") return startCopilotLogin(userDataRoot, templateId);
  if (driverId === "dsh") return startDshLogin(userDataRoot, templateId);
  if (driverId === "codebuddy") {
    return startCodebuddyLogin(userDataRoot, templateId, {
      environment: request.environment,
    });
  }
  throw new ConfigError(`尚未实现 ${driverId} 的登录`);
}

export async function checkAgentSdkLogin(
  userDataRoot: string,
  templateId: string,
  request: AgentSdkLoginRequest = {},
): Promise<LoginResult> {
  const driverId = driverIdOf(templateId);
  if (driverId === "cursor") return checkCursorLogin(userDataRoot, templateId);
  if (driverId === "codex") return checkCodexLogin(userDataRoot, templateId);
  if (driverId === "opencode") return checkOpencodeLogin(userDataRoot, templateId);
  if (driverId === "copilot") return checkCopilotLogin(userDataRoot, templateId);
  if (driverId === "dsh") return checkDshLogin(userDataRoot, templateId);
  if (driverId === "codebuddy") {
    return checkCodebuddyLogin(userDataRoot, templateId, {
      environment: request.environment,
    });
  }
  throw new ConfigError(`尚未实现 ${driverId} 的登录探测`);
}

/** OpenCode Zen Key / Copilot GitHub token 回落：写入隔离 home；其它 driver 拒绝。 */
export async function submitAgentSdkApiKey(
  userDataRoot: string,
  templateId: string,
  apiKey: string,
): Promise<LoginResult> {
  const driverId = driverIdOf(templateId);
  if (driverId === "opencode") {
    return submitOpencodeApiKey(userDataRoot, templateId, apiKey);
  }
  if (driverId === "copilot") {
    return submitCopilotApiKey(userDataRoot, templateId, apiKey);
  }
  if (driverId === "dsh") {
    return submitDshApiKey(userDataRoot, templateId, apiKey);
  }
  throw new ConfigError(`该接入方式不支持粘贴 API Key 登录`);
}

export async function logoutAgentSdk(userDataRoot: string, templateId: string): Promise<void> {
  // 登出前先杀保活 CLI/serve，避免旧凭据进程残留
  await disposeAgentSdkRuntimesForTemplate(userDataRoot, templateId);
  const driverId = driverIdOf(templateId);
  if (driverId === "cursor") {
    await logoutCursor(userDataRoot, templateId);
    return;
  }
  if (driverId === "codex") {
    await logoutCodex(userDataRoot, templateId);
    return;
  }
  if (driverId === "opencode") {
    await logoutOpencode(userDataRoot, templateId);
    return;
  }
  if (driverId === "copilot") {
    await logoutCopilot(userDataRoot, templateId);
    return;
  }
  if (driverId === "dsh") {
    await logoutDsh(userDataRoot, templateId);
    return;
  }
  if (driverId === "codebuddy") {
    await logoutCodebuddy(userDataRoot, templateId);
    return;
  }
  throw new ConfigError(`尚未实现 ${driverId} 的登出`);
}
