/**
 * 按模板 driverId 分发模型目录查询。
 */
import { ConfigError } from "../../load.js";
import { getProviderTemplate } from "../../provider-templates.js";
import {
  creditRateOf,
  ensureAgentSdkModels as ensureCodebuddyModels,
  fetchAgentSdkModels as fetchCodebuddyModels,
  refreshAgentSdkModels as refreshCodebuddyModels,
  syncAgentSdkModelsAfterLogin as syncCodebuddyModelsAfterLogin,
  type AgentSdkModel,
} from "../../../session/external/sdk/adapters/codebuddy/index.js";
import {
  ensureCodexModels,
  fetchCodexModels,
  refreshCodexModels,
} from "../../../session/external/sdk/adapters/codex/index.js";
import {
  ensureCursorModels,
  fetchCursorModels,
  refreshCursorModels,
} from "../../../session/external/sdk/adapters/cursor/index.js";

export type { AgentSdkModel };
export { creditRateOf };

function driverIdOf(templateId: string): string {
  const profile = getProviderTemplate(templateId)?.agentSdk;
  if (!profile?.driverId) throw new ConfigError("该接入方式没有本地模型目录");
  return profile.driverId;
}

export async function fetchAgentSdkModels(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  const driverId = driverIdOf(templateId);
  if (driverId === "cursor") return fetchCursorModels(userDataRoot, templateId);
  if (driverId === "codex") return fetchCodexModels(userDataRoot, templateId);
  if (driverId === "codebuddy") return fetchCodebuddyModels(userDataRoot, templateId);
  throw new ConfigError(`尚未实现 ${driverId} 的模型目录`);
}

export async function refreshAgentSdkModels(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  const driverId = driverIdOf(templateId);
  if (driverId === "cursor") return refreshCursorModels(userDataRoot, templateId);
  if (driverId === "codex") return refreshCodexModels(userDataRoot, templateId);
  if (driverId === "codebuddy") return refreshCodebuddyModels(userDataRoot, templateId);
  throw new ConfigError(`尚未实现 ${driverId} 的模型目录`);
}

export async function ensureAgentSdkModels(
  userDataRoot: string,
  templateId: string,
): Promise<void> {
  const driverId = driverIdOf(templateId);
  if (driverId === "cursor") {
    await ensureCursorModels(userDataRoot, templateId);
    return;
  }
  if (driverId === "codex") {
    await ensureCodexModels(userDataRoot, templateId);
    return;
  }
  if (driverId === "codebuddy") {
    await ensureCodebuddyModels(userDataRoot, templateId);
    return;
  }
}

export async function syncAgentSdkModelsAfterLogin(
  userDataRoot: string,
  templateId: string,
  options?: { accountChanged?: boolean },
): Promise<void> {
  // 各 adaptor 登录实现内部也会 sync；此函数留给旧调用路径。
  const driverId = driverIdOf(templateId);
  if (driverId === "cursor") {
    if (options?.accountChanged) {
      await refreshCursorModels(userDataRoot, templateId).catch(() => undefined);
    } else {
      await ensureCursorModels(userDataRoot, templateId);
    }
    return;
  }
  if (driverId === "codex") {
    if (options?.accountChanged) {
      await refreshCodexModels(userDataRoot, templateId).catch(() => undefined);
    } else {
      await ensureCodexModels(userDataRoot, templateId);
    }
    return;
  }
  if (driverId === "codebuddy") {
    await syncCodebuddyModelsAfterLogin(userDataRoot, templateId, options);
  }
}
