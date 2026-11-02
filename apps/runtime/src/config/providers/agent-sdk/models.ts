import { ConfigError } from "../../load.js";
import { getProviderTemplate } from "../../provider-templates.js";
import { agentSdkModels, setAgentSdkModels } from "../../provider/index.js";
import {
  installedCliPath,
  loadAgentSdkModule,
  withTimeout,
  type AgentSdkSession,
} from "./loader.js";

/**
 * 本地接入的可用模型：只能问本地 SDK（各家订阅里能用什么，服务端不知道）。
 *
 * 实测（docs/agent_cli §11）：`createSession()` + `getAvailableModels()` 不落任何提示词，
 * 只起一次 CLI 控制请求，返回 [{modelId,name}]；未登录时会挂住，所以外层掐超时。
 */

const MODEL_QUERY_TIMEOUT_MS = 30_000;
const MAX_AGENT_SDK_MODELS = 200;
/** 查询失败后先别一直拉起 CLI；设置页轮询登录态时会顺带重试。 */
const RETRY_COOLDOWN_MS = 60_000;

export interface AgentSdkModel {
  id: string;
  name: string;
  /** credit 消耗倍率（'x1.33 credits' → 1.33）；0 是真实值，认不出来才是 undefined */
  credits?: number;
}

const lastAttempt = new Map<string, number>();

/** 向已安装的本地 SDK 问一次模型目录。 */
export async function fetchAgentSdkModels(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  const template = getProviderTemplate(templateId);
  if (!template?.agentSdk) throw new ConfigError("该接入方式没有本地模型目录");
  const sdk = await loadAgentSdkModule(userDataRoot, templateId);
  const createSession = sdk.unstable_v2_createSession;
  if (typeof createSession !== "function") throw new ConfigError("本地 SDK 不支持查询模型");

  const cliPath = installedCliPath(userDataRoot, templateId);
  const session: AgentSdkSession = createSession.call(sdk, {
    ...(cliPath ? { pathToCodebuddyCode: cliPath } : {}),
  });
  try {
    // 优先问 raw：它带 credits 倍率等元信息；老 SDK 只有简版 → 回落简版
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

/** 查一次并写回本机配置；设置页的「启用服务」列表直接读这份目录。 */
export async function refreshAgentSdkModels(
  userDataRoot: string,
  templateId: string,
): Promise<AgentSdkModel[]> {
  const models = await fetchAgentSdkModels(userDataRoot, templateId);
  setAgentSdkModels(userDataRoot, templateId, models);
  return models;
}

/**
 * 登录刚成功时补一次查询：已有目录就不重复拉起 CLI，失败也不影响登录结果。
 * 桌面每 1.5 秒轮询一次登录态，靠 cooldown 避免同一分钟内反复起进程。
 */
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
    /* 查不到模型不推翻已登录状态，下次刷新再试 */
  }
}

/**
 * 登录刚成功时同步目录。
 *
 * 账号换了必须重拉：上一个账号的目录对当前账号是错的——会列出用不了的模型，
 * 也可能看不到新账号才有的模型。换账号是用户主动动作，不走 cooldown。
 * 账号没变就沿用 ensure 的节流（已有目录就不重复拉起 CLI）。
 */
export async function syncAgentSdkModelsAfterLogin(
  userDataRoot: string,
  templateId: string,
  options?: { accountChanged?: boolean },
): Promise<void> {
  if (!options?.accountChanged) {
    await ensureAgentSdkModels(userDataRoot, templateId);
    return;
  }
  // 旧目录先作废：万一这次查失败，也别留着上一个账号的模型骗人
  setAgentSdkModels(userDataRoot, templateId, []);
  lastAttempt.delete(templateId);
  try {
    await refreshAgentSdkModels(userDataRoot, templateId);
  } catch {
    /* 查不到就先空着，下次刷新再试 */
  }
}

function normalizeModels(raw: unknown): AgentSdkModel[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentSdkModel[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    // raw 版用 id，简版用 modelId；两种都认
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
    // 0 是真实倍率（自部署 / 免费档），只能用 !== undefined 判，别写成 credits ? ...
    out.push({ id, name, ...(credits === undefined ? {} : { credits }) });
    if (out.length >= MAX_AGENT_SDK_MODELS) break;
  }
  return out;
}

/**
 * `credits` 是各家给的倍率串（实测形如 'x1.33 credits'），不是价格。
 * 0 是真实值（'x0.00 credits'，自部署 / 免费档）→ 返回 0，UI 显示 ×0；
 * 认不出来（'free'、null、负数）才返回 undefined。
 */
export function creditRateOf(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const matched = /(\d+(?:\.\d+)?)/.exec(value);
  if (!matched) return undefined;
  const rate = Number(matched[1]);
  return Number.isFinite(rate) && rate >= 0 ? rate : undefined;
}
