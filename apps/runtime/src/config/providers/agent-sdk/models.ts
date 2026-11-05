/**
 * 按模板 driverId 分发模型目录查询。
 * 活拉取结果经 requireNonEmptyModelCatalog：空列表统一报错，禁假 FALLBACK。
 */
import { ConfigError } from "../../load.js";
import { setAgentSdkModels } from "../../provider/agent-sdk-state.js";
import { requireNonEmptyModelCatalog } from "../../provider/model-list-policy.js";
import { getProviderTemplate } from "../../provider-templates.js";
import {
  creditRateOf,
  ensureAgentSdkModels as ensureCodebuddyModels,
  fetchAgentSdkModels as fetchCodebuddyModels,
  syncAgentSdkModelsAfterLogin as syncCodebuddyModelsAfterLogin,
  type AgentSdkModel,
} from "../../../session/external/sdk/adapters/codebuddy/index.js";
import { ensureCodexModels, fetchCodexModels } from "../../../session/external/sdk/adapters/codex/index.js";
import {
  ensureCursorModels,
  fetchCursorModels,
} from "../../../session/external/sdk/adapters/cursor/index.js";
import {
  ensureCopilotModels,
  fetchCopilotModels,
} from "../../../session/external/sdk/adapters/copilot/index.js";
import {
  ensureClaudeModels,
  fetchClaudeModels,
} from "../../../session/external/sdk/adapters/claude-code/index.js";
import { ensureDshModels, fetchDshModels } from "../../../session/external/sdk/adapters/dsh/index.js";
import {
  ensureOpencodeModels,
  fetchOpencodeModels,
} from "../../../session/external/sdk/adapters/opencode/index.js";

export type { AgentSdkModel };
export { creditRateOf };

function driverIdOf(templateId: string): string {
  const profile = getProviderTemplate(templateId)?.agentSdk;
  if (!profile?.driverId) throw new ConfigError("该接入方式没有本地模型目录");
  return profile.driverId;
}

async function fetchByDriver(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  const driverId = driverIdOf(templateId);
  if (driverId === "cursor") return fetchCursorModels(userDataRoot, templateId);
  if (driverId === "codex") return fetchCodexModels(userDataRoot, templateId);
  if (driverId === "opencode") return fetchOpencodeModels(userDataRoot, templateId);
  if (driverId === "copilot") return fetchCopilotModels(userDataRoot, templateId);
  if (driverId === "dsh") return fetchDshModels(userDataRoot, templateId);
  if (driverId === "claude-code") return fetchClaudeModels(userDataRoot, templateId);
  if (driverId === "codebuddy") return fetchCodebuddyModels(userDataRoot, templateId);
  throw new ConfigError(`尚未实现 ${driverId} 的模型目录`);
}

export async function fetchAgentSdkModels(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  // 统一闸门：活拉取空目录不得冒充已发现
  return requireNonEmptyModelCatalog(await fetchByDriver(userDataRoot, templateId));
}

export async function refreshAgentSdkModels(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  // 统一闸门 + 落盘；失败抛错时不改写已有目录
  const models = await fetchAgentSdkModels(userDataRoot, templateId);
  setAgentSdkModels(userDataRoot, templateId, models);
  return models;
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
  if (driverId === "opencode") {
    await ensureOpencodeModels(userDataRoot, templateId);
    return;
  }
  if (driverId === "copilot") {
    await ensureCopilotModels(userDataRoot, templateId);
    return;
  }
  if (driverId === "dsh") {
    await ensureDshModels(userDataRoot, templateId);
    return;
  }
  if (driverId === "claude-code") {
    await ensureClaudeModels(userDataRoot, templateId);
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
  // 换账号强制刷；否则 ensure。失败不推翻登录。
  if (driverIdOf(templateId) === "codebuddy") {
    await syncCodebuddyModelsAfterLogin(userDataRoot, templateId, options);
    return;
  }
  if (options?.accountChanged) {
    await refreshAgentSdkModels(userDataRoot, templateId).catch(() => undefined);
    return;
  }
  await ensureAgentSdkModels(userDataRoot, templateId);
}
