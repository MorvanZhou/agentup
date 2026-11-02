import type { UiLocale } from "../../i18n/index.js";
import { ConfigError } from "../load.js";
import { readProviderSettings } from "./settings-view.js";
import { patchStored, readStored } from "./store.js";
import type { ModelRef, ProviderSettingsView } from "./types.js";
import { modelKey } from "./util.js";
import { validateModelRef } from "./validate.js";

export function setModelEnabled(
  userDataRoot: string,
  ref: ModelRef,
  enabled: boolean,
  locale: UiLocale = "zh",
): ProviderSettingsView {
  const stored = readStored(userDataRoot);
  const model = validateModelRef(ref, stored);
  let enabledModels = [...stored.enabledModels];
  let activeModel = stored.activeModel;
  const key = modelKey(model);
  const exists = enabledModels.some((item) => modelKey(item) === key);
  if (enabled && !exists) {
    enabledModels.push(model);
    if (!activeModel) activeModel = model;
  }
  if (!enabled && exists) {
    enabledModels = enabledModels.filter((item) => modelKey(item) !== key);
    if (activeModel && modelKey(activeModel) === key) {
      activeModel = enabledModels[0] ?? null;
    }
  }
  patchStored(userDataRoot, stored, { enabledModels, activeModel });
  return readProviderSettings(userDataRoot, process.env, locale);
}

export function setActiveModel(
  userDataRoot: string,
  ref: ModelRef,
  locale: UiLocale = "zh",
): ProviderSettingsView {
  const stored = readStored(userDataRoot);
  const model = validateModelRef(ref, stored);
  let enabledModels = [...stored.enabledModels];
  if (!enabledModels.some((item) => modelKey(item) === modelKey(model))) {
    enabledModels.push(model);
  }
  patchStored(userDataRoot, stored, { enabledModels, activeModel: model });
  return readProviderSettings(userDataRoot, process.env, locale);
}

/** 校验 ref 已连接且已启用（会话切换用）。 */
export function requireEnabledModelRef(userDataRoot: string, ref: ModelRef): ModelRef {
  const stored = readStored(userDataRoot);
  const model = validateModelRef(ref, stored);
  if (!stored.enabledModels.some((item) => modelKey(item) === modelKey(model))) {
    throw new ConfigError("请先在设置中启用该模型");
  }
  return model;
}

/** 会话 sidecar 回落：已连接且已启用则返回规范化 ref，否则 null。 */
export function tryEnabledModelRef(
  userDataRoot: string,
  ref: ModelRef | null | undefined,
): ModelRef | null {
  if (!ref) return null;
  try {
    return requireEnabledModelRef(userDataRoot, ref);
  } catch {
    return null;
  }
}

/** 仅更新「最近使用」标记；不自动把未启用模型加进 enabled。 */
export function touchActiveModel(userDataRoot: string, ref: ModelRef): void {
  const stored = readStored(userDataRoot);
  const model = validateModelRef(ref, stored);
  if (!stored.enabledModels.some((item) => modelKey(item) === modelKey(model))) return;
  if (stored.activeModel && modelKey(stored.activeModel) === modelKey(model)) return;
  patchStored(userDataRoot, stored, { activeModel: model });
}

/** 无会话模型时可回落的候选：仍已连接的 enabled 第一个。 */
export function firstEnabledModelRef(userDataRoot: string): ModelRef | null {
  const stored = readStored(userDataRoot);
  for (const model of stored.enabledModels) {
    const usable = tryEnabledModelRef(userDataRoot, model);
    if (usable) return usable;
  }
  return null;
}
