import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { ConfigError } from "../src/config/load.js";
import {
  clearRuntimeProviderSecrets,
  deleteProviderConnection,
  loadModelConfig,
  ProviderSecretPendingError,
  readProviderSettings,
  removeCustomModel,
  setActiveModel,
  setModelEnabled,
  setRuntimeProviderSecrets,
  upsertProviderConnection,
} from "../src/config/provider.js";

it("persists provider connections and loads the active model", () => {
  clearRuntimeProviderSecrets();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-provider-"));
  expect(readProviderSettings(root, {}).configured).toBe(false);
  expect(() => loadModelConfig(root, {})).toThrow(/连接服务商并启用/);

  const settings = upsertProviderConnection(root, {
    templateId: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1/",
    customModelId: "qwen3:0.6b",
  });
  expect(settings.configured).toBe(true);
  expect(settings.activeModel).toEqual({ templateId: "ollama", modelId: "qwen3:0.6b" });
  expect(settings.availableModels.some((m) => m.modelId === "qwen3:0.6b" && m.enabled)).toBe(true);
  expect(loadModelConfig(root, {})).toMatchObject({
    providerId: "ollama",
    templateId: "ollama",
    modelId: "qwen3:0.6b",
    apiKey: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    kind: "ollama",
  });
  expect(fs.statSync(path.join(root, "settings", "provider.json")).mode & 0o777).toBe(0o600);
});

it("requires hydrated runtime secrets for cloud providers", () => {
  clearRuntimeProviderSecrets();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-provider-"));
  const settings = upsertProviderConnection(root, {
    templateId: "deepseek",
    apiKeyCipher: "cipher",
  });
  const modelId = settings.availableModels[0]?.modelId;
  expect(modelId).toBeTruthy();
  setActiveModel(root, { templateId: "deepseek", modelId: modelId! });
  // 密文已在盘上、进程还没收到明文：不是让用户重存密钥。
  expect(() => loadModelConfig(root, {})).toThrow(ProviderSecretPendingError);
  expect(() => loadModelConfig(root, {})).not.toThrow(/重新保存/);
  setRuntimeProviderSecrets({ deepseek: "sk-test" });
  expect(loadModelConfig(root, {})).toMatchObject({
    providerId: "deepseek",
    modelId,
    apiKey: "sk-test",
    kind: "pi-native",
  });
});

it("asks to save the key again only when nothing is stored", () => {
  clearRuntimeProviderSecrets();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-provider-"));
  const settings = upsertProviderConnection(root, { templateId: "deepseek" });
  const modelId = settings.availableModels[0]?.modelId;
  expect(modelId).toBeTruthy();
  setActiveModel(root, { templateId: "deepseek", modelId: modelId! });
  expect(() => loadModelConfig(root, {})).toThrow(/重新保存密钥/);
});

it("toggles enabled models and keeps an active selection", () => {
  clearRuntimeProviderSecrets();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-provider-"));
  upsertProviderConnection(root, {
    templateId: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    customModelId: "a",
  });
  upsertProviderConnection(root, {
    templateId: "ollama",
    customModelId: "b",
  });
  let settings = setModelEnabled(root, { templateId: "ollama", modelId: "b" }, true);
  expect(settings.availableModels.find((m) => m.modelId === "b")?.enabled).toBe(true);
  settings = setActiveModel(root, { templateId: "ollama", modelId: "b" });
  expect(settings.activeModel).toEqual({ templateId: "ollama", modelId: "b" });
  settings = setModelEnabled(root, { templateId: "ollama", modelId: "b" }, false);
  expect(settings.activeModel?.modelId).toBe("a");
  deleteProviderConnection(root, "ollama");
  expect(readProviderSettings(root, {}).configured).toBe(false);
});

it("removes a manually added custom model from the list", () => {
  clearRuntimeProviderSecrets();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-provider-rm-"));
  upsertProviderConnection(root, {
    templateId: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    customModelId: "keep-me",
  });
  upsertProviderConnection(root, {
    templateId: "ollama",
    customModelId: "drop-me",
  });
  let settings = setActiveModel(root, { templateId: "ollama", modelId: "drop-me" });
  expect(settings.availableModels.find((m) => m.modelId === "drop-me")?.custom).toBe(true);

  settings = removeCustomModel(root, { templateId: "ollama", modelId: "drop-me" });
  expect(settings.connections[0]?.customModelIds).toEqual(["keep-me"]);
  expect(settings.availableModels.map((m) => m.modelId)).toEqual(["keep-me"]);
  expect(settings.activeModel).toEqual({ templateId: "ollama", modelId: "keep-me" });
  expect(() => removeCustomModel(root, { templateId: "ollama", modelId: "keep-me-not" })).toThrow(
    ConfigError,
  );
});

it("keeps environment variables as the highest-priority developer override", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-provider-"));
  upsertProviderConnection(root, {
    templateId: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    customModelId: "saved",
  });
  const config = loadModelConfig(root, {
    AGENTUP_MODEL_NAME: "from-env",
    AGENTUP_MODEL_BASE_URL: "http://127.0.0.1:8080/v1",
    AGENTUP_MODEL_PROVIDER: "ollama",
  });
  expect(config).toMatchObject({ modelId: "from-env", baseUrl: "http://127.0.0.1:8080/v1" });
  expect(readProviderSettings(root, { AGENTUP_MODEL_NAME: "from-env" }).overriddenByEnvironment).toBe(true);
});

it("rejects invalid provider connections", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-provider-"));
  expect(() =>
    upsertProviderConnection(root, {
      templateId: "ollama",
      baseUrl: "file:///tmp/model",
    }),
  ).toThrow(ConfigError);
  expect(() =>
    upsertProviderConnection(root, {
      templateId: "nope",
    }),
  ).toThrow("未知的服务商");
});
