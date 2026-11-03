import { ConfigError } from "../../../../../config/load.js";
import { getProviderTemplate } from "../../../../../config/provider-templates.js";
import { agentSdkModels, setAgentSdkModels } from "../../../../../config/provider/index.js";
import { installedCliPath, loadCodebuddyModule, withTimeout, type CodebuddySession } from "./load.js";

const MODEL_QUERY_TIMEOUT_MS = 30_000;
const MAX_AGENT_SDK_MODELS = 200;
const RETRY_COOLDOWN_MS = 60_000;

export interface AgentSdkModel {
  id: string;
  name: string;
  credits?: number;
}

const lastAttempt = new Map<string, number>();

export async function fetchAgentSdkModels(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  const template = getProviderTemplate(templateId);
  if (!template?.agentSdk) throw new ConfigError("该接入方式没有本地模型目录");
  const sdk = await loadCodebuddyModule(userDataRoot, templateId);
  const createSession = sdk.unstable_v2_createSession;
  if (typeof createSession !== "function") throw new ConfigError("本地 SDK 不支持查询模型");

  const cliPath = installedCliPath(userDataRoot, templateId);
  const session: CodebuddySession = createSession.call(sdk, {
    ...(cliPath ? { pathToCodebuddyCode: cliPath } : {}),
  });
  try {
    const rawQuery = session.getAvailableModelsRaw;
    const raw =
      typeof rawQuery === "function"
        ? await withTimeout(rawQuery.call(session), MODEL_QUERY_TIMEOUT_MS)
        : null;
    let models = normalizeModels(raw);
    if (!models.length) {
      const query = session.getAvailableModels;
      if (typeof query !== "function") throw new ConfigError("本地 SDK 不支持查询模型");
      models = normalizeModels(await withTimeout(query.call(session), MODEL_QUERY_TIMEOUT_MS));
    }
    if (!models.length) throw new ConfigError("本地接入没有返回可用模型");
    return models;
  } finally {
    try {
      session.close?.();
    } catch {
      /* 关不掉也别挡住结果 */
    }
  }
}

export async function refreshAgentSdkModels(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  const models = await fetchAgentSdkModels(userDataRoot, templateId);
  setAgentSdkModels(userDataRoot, templateId, models);
  return models;
}

export async function ensureAgentSdkModels(
  userDataRoot: string,
  templateId: string,
): Promise<void> {
  if (agentSdkModels(userDataRoot, templateId).length > 0) return;
  const last = lastAttempt.get(templateId) ?? 0;
  if (Date.now() - last < RETRY_COOLDOWN_MS) return;
  lastAttempt.set(templateId, Date.now());
  try {
    await refreshAgentSdkModels(userDataRoot, templateId);
  } catch {
    /* 查不到模型不推翻已登录状态 */
  }
}

export async function syncAgentSdkModelsAfterLogin(
  userDataRoot: string,
  templateId: string,
  options?: { accountChanged?: boolean },
): Promise<void> {
  if (!options?.accountChanged) {
    await ensureAgentSdkModels(userDataRoot, templateId);
    return;
  }
  setAgentSdkModels(userDataRoot, templateId, []);
  lastAttempt.delete(templateId);
  try {
    await refreshAgentSdkModels(userDataRoot, templateId);
  } catch {
    /* 查不到就先空着 */
  }
}

function normalizeModels(raw: unknown): AgentSdkModel[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentSdkModel[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as { modelId?: unknown; id?: unknown; name?: unknown; credits?: unknown };
    const id =
      typeof record.modelId === "string"
        ? record.modelId.trim()
        : typeof record.id === "string"
          ? record.id.trim()
          : "";
    if (!id || seen.has(id)) continue;
    const name = (typeof record.name === "string" && record.name.trim()) || id;
    seen.add(id);
    const credits = creditRateOf(record.credits);
    out.push({ id, name, ...(credits === undefined ? {} : { credits }) });
    if (out.length >= MAX_AGENT_SDK_MODELS) break;
  }
  return out;
}

export function creditRateOf(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const matched = /(\d+(?:\.\d+)?)/.exec(value);
  if (!matched) return undefined;
  const rate = Number(matched[1]);
  return Number.isFinite(rate) && rate >= 0 ? rate : undefined;
}
