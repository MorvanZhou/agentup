import type { UiLocale } from "../../i18n/index.js";
import { syncAgentSdkCatalog } from "../model-catalog.js";
import { ConfigError } from "../load.js";
import { getProviderTemplate, listAgentSdkTemplates } from "../provider-templates.js";
import type {
  AgentSdkAuthEnvironment,
  AgentSdkModel,
  AgentSdkRecord,
  AgentSdkState,
  AgentSdkView,
} from "./types.js";
import { patchStored, readStored } from "./store.js";
import { clean } from "./util.js";
import { normalizeAgentSdkAuthEnvironment, normalizeAgentSdkModels } from "./validate.js";

/** 目录（模板）+ 本机状态；没记录的模板一律 not_installed。 */
export function buildAgentSdkViews(records: AgentSdkRecord[], locale: UiLocale): AgentSdkView[] {
  const byId = new Map(records.map((item) => [item.templateId, item]));
  return listAgentSdkTemplates(locale).map((template) => {
    const record = byId.get(template.id);
    const authEnvironments = template.agentSdk?.authEnvironments?.length
      ? [...template.agentSdk.authEnvironments]
      : undefined;
    return {
      templateId: template.id,
      vendorLabel: template.vendorLabel,
      optionLabel: template.optionLabel,
      label: template.label,
      hint: template.hint,
      package: template.agentSdk?.package ?? "",
      sizeHintMb: template.agentSdk?.sizeHintMb ?? 0,
      loginGuide: template.agentSdk?.loginGuide,
      state: record?.state ?? "not_installed",
      installedVersion: record?.installedVersion,
      lastError: record?.lastError,
      accountLabel: record?.accountLabel,
      models: record?.models,
      ...(authEnvironments ? { authEnvironments } : {}),
      ...(record?.authEnvironment ? { authEnvironment: record.authEnvironment } : {}),
      ...(template.agentSdk?.apiKeyPaste
        ? { apiKeyPaste: template.agentSdk.apiKeyPaste }
        : {}),
    };
  });
}

/** 推进本地 SDK 状态（阶段 1 的安装/登录流程用）；只写状态与版本，不收 token。 */
export function setAgentSdkState(
  userDataRoot: string,
  templateId: string,
  state: AgentSdkState,
  extra: { installedVersion?: string; lastError?: string } = {},
): void {
  const id = clean(templateId);
  if (!id) throw new ConfigError("请选择接入方式");
  if (!getProviderTemplate(id)) throw new ConfigError("未知的服务商");
  const stored = readStored(userDataRoot);
  const previous = stored.agentSdks.find((item) => item.templateId === id);
  const records = stored.agentSdks.filter((item) => item.templateId !== id);
  // 推进状态不该顺手清掉目录 / 版本 / 账号：那几项各有自己的写入口
  // （setAgentSdkModels / setAgentSdkAccountLabel），要清就得显式清。
  // 以前重建记录会把它们一起丢了：一次普通登录也会清空目录 → 白拉一次 CLI。
  const version = extra.installedVersion ?? previous?.installedVersion;
  records.push({
    templateId: id,
    state,
    ...(version ? { installedVersion: version } : {}),
    ...(extra.lastError ? { lastError: extra.lastError } : {}),
    ...(previous?.accountLabel ? { accountLabel: previous.accountLabel } : {}),
    ...(previous?.models?.length ? { models: previous.models } : {}),
    // 站点偏好跟账号/目录一样：推进状态时保留，换站走 setAgentSdkAuthEnvironment
    ...(previous?.authEnvironment ? { authEnvironment: previous.authEnvironment } : {}),
  });
  patchStored(userDataRoot, stored, { agentSdks: records });
}

/** 写回本地 SDK 查到的模型目录；没有安装记录时不凭空建状态。 */
export function setAgentSdkModels(
  userDataRoot: string,
  templateId: string,
  models: AgentSdkModel[],
): void {
  const id = clean(templateId);
  if (!id) return;
  const normalized = normalizeAgentSdkModels(models);
  mutateAgentSdkRecords(userDataRoot, id, (item) => ({
    ...item,
    models: normalized,
  }));
  // 同步进 model-catalog，供 resolveModelLimits / Host 压缩预算读取
  syncAgentSdkCatalog(userDataRoot, id, normalized);
}

/** 本地接入的本机状态；没记录（未装过）就是 null。开会话前先看它，别白跑一趟。 */
export function agentSdkStateOf(userDataRoot: string, templateId: string): AgentSdkState | null {
  const record = readStored(userDataRoot).agentSdks.find((item) => item.templateId === templateId);
  return record?.state ?? null;
}

/** 本地接入已查到的模型目录；没查过就是空。 */
export function agentSdkModels(userDataRoot: string, templateId: string): AgentSdkModel[] {
  const record = readStored(userDataRoot).agentSdks.find((item) => item.templateId === templateId);
  return record?.models ?? [];
}

/**
 * 写回登录账号的展示名（只给人看，token 永不落盘）。传 null / 空串清掉。
 * 单独一个入口：账号归它管，状态推进（setAgentSdkState）不该顺手改账号。
 */
export function setAgentSdkAccountLabel(
  userDataRoot: string,
  templateId: string,
  label: string | null,
): void {
  const id = clean(templateId);
  if (!id) return;
  const text = typeof label === "string" ? clean(label) : "";
  mutateAgentSdkRecords(userDataRoot, id, (item) => {
    const next: AgentSdkRecord = { ...item };
    delete next.accountLabel;
    if (text) next.accountLabel = text;
    return next;
  });
}

/** 已记住的登录账号；没登录 / 老配置没有这个字段 → undefined。 */
export function agentSdkAccountLabel(userDataRoot: string, templateId: string): string | undefined {
  const id = clean(templateId);
  if (!id) return undefined;
  return readStored(userDataRoot).agentSdks.find((item) => item.templateId === id)?.accountLabel;
}

/**
 * 记住登录站点（CodeBuddy environment）。登出不清，方便同站再登。
 * 没有安装记录时不凭空建状态。
 */
export function setAgentSdkAuthEnvironment(
  userDataRoot: string,
  templateId: string,
  environment: AgentSdkAuthEnvironment | null,
): void {
  const id = clean(templateId);
  if (!id) return;
  const next = environment ? normalizeAgentSdkAuthEnvironment(environment) : null;
  mutateAgentSdkRecords(userDataRoot, id, (item) => {
    const record: AgentSdkRecord = { ...item };
    delete record.authEnvironment;
    if (next) record.authEnvironment = next;
    return record;
  });
}

/** 本机已选登录站点；老配置 / 未选过 → undefined。 */
export function agentSdkAuthEnvironment(
  userDataRoot: string,
  templateId: string,
): AgentSdkAuthEnvironment | undefined {
  const id = clean(templateId);
  if (!id) return undefined;
  return readStored(userDataRoot).agentSdks.find((item) => item.templateId === id)?.authEnvironment;
}

/**
 * 读-改-写单条本地接入记录；没有该模板的记录就什么都不做（不凭空建状态）。
 * mutate 只改这一条，其余记录原样保留。
 */
function mutateAgentSdkRecords(
  userDataRoot: string,
  templateId: string,
  mutate: (record: AgentSdkRecord) => AgentSdkRecord,
): void {
  const stored = readStored(userDataRoot);
  if (!stored.agentSdks.some((item) => item.templateId === templateId)) return;
  const records = stored.agentSdks.map((item) =>
    item.templateId === templateId ? mutate(item) : item,
  );
  patchStored(userDataRoot, stored, { agentSdks: records });
}
