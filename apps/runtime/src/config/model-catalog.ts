import fs from "node:fs";
import path from "node:path";

import type { Api, Model } from "@earendil-works/pi-ai";

import { getProviderTemplate } from "./provider-templates.js";
import { volcengineArkProviderConfig } from "./providers/volcengine-ark.js";

const FILE_VERSION = 1 as const;
export const DEFAULT_CONTEXT_WINDOW = 128_000;
export const DEFAULT_MAX_TOKENS = 16_384;

export interface ModelCatalogEntry {
  name: string;
  contextWindow: number;
  maxTokens: number;
}

export interface ModelCatalogProvider {
  refreshedAt: string;
  models: Record<string, ModelCatalogEntry>;
}

interface StoredCatalog {
  version: typeof FILE_VERSION;
  providers: Record<string, ModelCatalogProvider>;
}

export function modelCatalogPath(userDataRoot: string): string {
  return path.join(userDataRoot, "settings", "model-catalog.json");
}

export function readModelCatalog(userDataRoot: string): StoredCatalog {
  const file = modelCatalogPath(userDataRoot);
  if (!fs.existsSync(file)) return { version: FILE_VERSION, providers: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    if (raw.version !== FILE_VERSION || !raw.providers || typeof raw.providers !== "object") {
      return { version: FILE_VERSION, providers: {} };
    }
    const providers: Record<string, ModelCatalogProvider> = {};
    for (const [templateId, value] of Object.entries(raw.providers as Record<string, unknown>)) {
      const parsed = parseProvider(value);
      if (parsed) providers[templateId] = parsed;
    }
    return { version: FILE_VERSION, providers };
  } catch {
    return { version: FILE_VERSION, providers: {} };
  }
}

export function readCatalogEntry(
  userDataRoot: string,
  templateId: string,
  modelId: string,
): ModelCatalogEntry | undefined {
  return readModelCatalog(userDataRoot).providers[templateId]?.models[modelId];
}

/** 缓存优先；否则从内置模板/静态表回落；再否则默认 128k。 */
export function resolveModelLimits(
  userDataRoot: string,
  templateId: string,
  modelId: string,
): ModelCatalogEntry {
  if (userDataRoot) {
    const cached = readCatalogEntry(userDataRoot, templateId, modelId);
    if (cached) return cached;
  }
  const fromTemplate = peekTemplateModelLimits(templateId, modelId);
  if (fromTemplate) return fromTemplate;
  return {
    name: modelId,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

export function removeProviderCatalog(userDataRoot: string, templateId: string): void {
  const stored = readModelCatalog(userDataRoot);
  if (!stored.providers[templateId]) return;
  delete stored.providers[templateId];
  persistCatalog(userDataRoot, stored);
}

/**
 * 按当前连接已知模型 id 刷新该供应商目录缓存。
 * - pi-native / volcengine-ark：整表写入内置元数据（含 contextWindow）
 * - 可发现 / 自定义：为 id 列表写入条目；已有窗口保留，新 id 用默认值
 */
export function syncProviderCatalog(
  userDataRoot: string,
  templateId: string,
  knownModelIds: string[],
): void {
  const template = getProviderTemplate(templateId);
  if (!template) return;

  const previous = readModelCatalog(userDataRoot).providers[templateId]?.models ?? {};
  const models: Record<string, ModelCatalogEntry> = {};

  if (template.kind === "pi-native" && template.createNative) {
    for (const model of template.createNative().getModels()) {
      models[model.id] = entryFromPiModel(model);
    }
  } else if (template.kind === "volcengine-ark") {
    for (const model of volcengineArkProviderConfig.models) {
      models[model.id] = {
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      };
    }
  } else {
    for (const id of uniqueIds(knownModelIds)) {
      const prior = previous[id];
      models[id] = prior
        ? { ...prior }
        : {
            name: id,
            contextWindow: DEFAULT_CONTEXT_WINDOW,
            maxTokens: DEFAULT_MAX_TOKENS,
          };
    }
  }

  const stored = readModelCatalog(userDataRoot);
  stored.providers[templateId] = {
    refreshedAt: new Date().toISOString(),
    models,
  };
  persistCatalog(userDataRoot, stored);
}

export function peekTemplateModelLimits(
  templateId: string,
  modelId: string,
): ModelCatalogEntry | undefined {
  const template = getProviderTemplate(templateId);
  if (!template) return undefined;
  if (template.kind === "pi-native" && template.createNative) {
    const model = template.createNative().getModels().find((item) => item.id === modelId);
    return model ? entryFromPiModel(model) : undefined;
  }
  if (template.kind === "volcengine-ark") {
    const model = volcengineArkProviderConfig.models.find((item) => item.id === modelId);
    if (!model) return undefined;
    return {
      name: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    };
  }
  return undefined;
}

function entryFromPiModel(model: Model<Api>): ModelCatalogEntry {
  return {
    name: model.name || model.id,
    contextWindow: model.contextWindow > 0 ? model.contextWindow : DEFAULT_CONTEXT_WINDOW,
    maxTokens: model.maxTokens > 0 ? model.maxTokens : DEFAULT_MAX_TOKENS,
  };
}

function parseProvider(value: unknown): ModelCatalogProvider | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (!row.models || typeof row.models !== "object" || Array.isArray(row.models)) return undefined;
  const models: Record<string, ModelCatalogEntry> = {};
  for (const [modelId, raw] of Object.entries(row.models as Record<string, unknown>)) {
    const entry = parseEntry(raw, modelId);
    if (entry) models[modelId] = entry;
  }
  return {
    refreshedAt: typeof row.refreshedAt === "string" ? row.refreshedAt : new Date(0).toISOString(),
    models,
  };
}

function parseEntry(value: unknown, fallbackName: string): ModelCatalogEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const contextWindow = Number(row.contextWindow);
  const maxTokens = Number(row.maxTokens);
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) return undefined;
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) return undefined;
  return {
    name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : fallbackName,
    contextWindow,
    maxTokens,
  };
}

function persistCatalog(userDataRoot: string, value: StoredCatalog): void {
  const target = modelCatalogPath(userDataRoot);
  const directory = path.dirname(target);
  const temporary = `${target}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}
