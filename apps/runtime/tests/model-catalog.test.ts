import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import {
  DEFAULT_CONTEXT_WINDOW,
  modelCatalogPath,
  readCatalogEntry,
  resolveModelLimits,
} from "../src/config/model-catalog.js";
import {
  clearRuntimeProviderSecrets,
  deleteProviderConnection,
  loadModelConfig,
  refreshProviderModels,
  setRuntimeProviderSecrets,
  upsertProviderConnection,
} from "../src/config/provider.js";
import { openModelRuntime } from "../src/session/model/runtime.js";
import { buildSessionPlan } from "../src/session/plan.js";
import type { Visit } from "../src/package/sync.js";

afterEach(() => {
  vi.unstubAllGlobals();
  clearRuntimeProviderSecrets();
});

it("writes built-in context windows when connecting a native provider", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-catalog-native-"));
  const settings = upsertProviderConnection(root, {
    templateId: "deepseek",
    apiKeyCipher: "cipher",
  });
  const modelId = settings.availableModels[0]?.modelId;
  expect(modelId).toBeTruthy();
  const entry = readCatalogEntry(root, "deepseek", modelId!);
  expect(entry?.contextWindow).toBeGreaterThan(100_000);
  expect(fs.existsSync(modelCatalogPath(root))).toBe(true);
  expect(fs.statSync(modelCatalogPath(root)).mode & 0o777).toBe(0o600);

  setRuntimeProviderSecrets({ deepseek: "sk-test" });
  expect(loadModelConfig(root, {})).toMatchObject({
    modelId,
    contextWindow: entry?.contextWindow,
    maxTokens: entry?.maxTokens,
  });
});

it("caches default windows for discovered custom models and uses them at session open", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-catalog-custom-"));
  upsertProviderConnection(root, {
    templateId: "custom-openai",
    baseUrl: "https://api.example.com/v1",
    apiKeyCipher: "cipher",
  });
  setRuntimeProviderSecrets({ "custom-openai": "sk-live" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ data: [{ id: "my-model-a" }] })),
  );
  await refreshProviderModels(root, "custom-openai");

  expect(readCatalogEntry(root, "custom-openai", "my-model-a")).toEqual({
    name: "my-model-a",
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: 16_384,
  });

  const visit: Visit = {
    userId: "u",
    agentId: "a",
    root: fs.mkdtempSync(path.join(os.tmpdir(), "agentup-catalog-visit-")),
    packageVersion: 1,
    packageDigest: "digest",
    tools: ["bash"],
    modelCapabilities: ["tools"],
    projectTrust: "granted",
  };
  const model = loadModelConfig(root, {});
  const plan = buildSessionPlan(visit, model);
  const opened = await openModelRuntime(plan);
  expect(opened.model.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
});

it("removes catalog entries when a connection is deleted", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-catalog-del-"));
  upsertProviderConnection(root, {
    templateId: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    customModelId: "qwen3:4b",
  });
  expect(readCatalogEntry(root, "ollama", "qwen3:4b")?.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
  deleteProviderConnection(root, "ollama");
  expect(readCatalogEntry(root, "ollama", "qwen3:4b")).toBeUndefined();
});

it("falls back to built-in limits when the catalog file is missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-catalog-miss-"));
  const limits = resolveModelLimits(root, "anthropic", "claude-haiku-4-5");
  expect(limits.contextWindow).toBe(200_000);
});
