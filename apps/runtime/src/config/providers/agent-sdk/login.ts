/**
 * 按模板 driverId 分发登录；设置页仍只认本文件的 API 形状。
 */
import { ConfigError } from "../../load.js";
import { getProviderTemplate } from "../../provider-templates.js";
import type { AgentSdkAuthEnvironment } from "../../provider/types.js";
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
  if (driverId === "codebuddy") {
    return checkCodebuddyLogin(userDataRoot, templateId, {
      environment: request.environment,
    });
  }
  throw new ConfigError(`尚未实现 ${driverId} 的登录探测`);
}

export async function logoutAgentSdk(userDataRoot: string, templateId: string): Promise<void> {
  const driverId = driverIdOf(templateId);
  if (driverId === "cursor") {
    await logoutCursor(userDataRoot, templateId);
    return;
  }
  if (driverId === "codex") {
    await logoutCodex(userDataRoot, templateId);
    return;
  }
  if (driverId === "codebuddy") {
    await logoutCodebuddy(userDataRoot, templateId);
    return;
  }
  throw new ConfigError(`尚未实现 ${driverId} 的登出`);
}
