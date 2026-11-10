import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  clearRuntimeProviderSecrets,
  deleteProviderConnection,
  loadModelConfigFromRef,
  readProviderSettings,
  setModelEnabled,
  setRuntimeProviderSecrets,
  upsertProviderConnection,
} from "../src/config/provider/index.js";

it("allows two custom-openai connections with distinct base urls and model refs", () => {
  clearRuntimeProviderSecrets();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-multi-custom-"));

  const first = upsertProviderConnection(root, {
    templateId: "custom-openai",
    baseUrl: "https://a.example/v1",
    apiKeyCipher: "cipher-a",
    customModelId: "model-a",
    displayName: "Gateway A",
  });
  expect(first.connections).toHaveLength(1);
  const connectionA = first.connections[0]!;
  expect(connectionA.connectionId).toBeTruthy();
  expect(connectionA.templateId).toBe("custom-openai");
  expect(connectionA.displayName).toBe("Gateway A");
  expect(connectionA.label).toContain("Gateway A");

  const second = upsertProviderConnection(root, {
    templateId: "custom-openai",
    createNew: true,
    baseUrl: "https://b.example/v1",
    apiKeyCipher: "cipher-b",
    customModelId: "model-b",
    displayName: "Gateway B",
  });
  expect(second.connections).toHaveLength(2);
  const connectionB = second.connections.find((item) => item.displayName === "Gateway B");
  expect(connectionB?.connectionId).toBeTruthy();
  expect(connectionB?.connectionId).not.toBe(connectionA.connectionId);

  const models = second.availableModels.filter((item) => item.templateId === "custom-openai");
  expect(models.map((item) => item.modelId).sort()).toEqual(["model-a", "model-b"]);
  expect(new Set(models.map((item) => item.connectionId)).size).toBe(2);

  setRuntimeProviderSecrets({
    [connectionA.connectionId]: "sk-a",
    [connectionB!.connectionId]: "sk-b",
  });
  setModelEnabled(
    root,
    { templateId: "custom-openai", connectionId: connectionA.connectionId, modelId: "model-a" },
    true,
  );
  setModelEnabled(
    root,
    { templateId: "custom-openai", connectionId: connectionB!.connectionId, modelId: "model-b" },
    true,
  );

  expect(
    loadModelConfigFromRef(root, {
      templateId: "custom-openai",
      connectionId: connectionA.connectionId,
      modelId: "model-a",
    }),
  ).toMatchObject({
    baseUrl: "https://a.example/v1",
    apiKey: "sk-a",
    modelId: "model-a",
    profileId: connectionA.connectionId,
  });
  expect(
    loadModelConfigFromRef(root, {
      templateId: "custom-openai",
      connectionId: connectionB!.connectionId,
      modelId: "model-b",
    }),
  ).toMatchObject({
    baseUrl: "https://b.example/v1",
    apiKey: "sk-b",
    modelId: "model-b",
    profileId: connectionB!.connectionId,
  });
});

it("allows two ollama endpoints and deletes one without dropping the other", () => {
  clearRuntimeProviderSecrets();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-multi-ollama-"));

  const first = upsertProviderConnection(root, {
    templateId: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    customModelId: "llama-local",
  });
  const idA = first.connections[0]!.connectionId;

  const second = upsertProviderConnection(root, {
    templateId: "ollama",
    createNew: true,
    baseUrl: "http://192.168.1.5:11434/v1",
    customModelId: "llama-remote",
    displayName: "Office Ollama",
  });
  const idB = second.connections.find((item) => item.connectionId !== idA)!.connectionId;
  expect(second.connections).toHaveLength(2);

  deleteProviderConnection(root, idA);
  const left = readProviderSettings(root, {});
  expect(left.connections).toHaveLength(1);
  expect(left.connections[0]?.connectionId).toBe(idB);
  expect(left.availableModels.map((item) => item.modelId)).toEqual(["llama-remote"]);
});

it("migrates legacy connections without connectionId to templateId", () => {
  clearRuntimeProviderSecrets();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-legacy-conn-"));
  fs.mkdirSync(path.join(root, "settings"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "settings", "provider.json"),
    `${JSON.stringify(
      {
        version: 3,
        connections: [
          {
            templateId: "ollama",
            baseUrl: "http://127.0.0.1:11434/v1",
            customModelIds: ["legacy-model"],
          },
        ],
        enabledModels: [{ templateId: "ollama", modelId: "legacy-model" }],
        activeModel: { templateId: "ollama", modelId: "legacy-model" },
        agentSdks: [],
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  const settings = readProviderSettings(root, {});
  expect(settings.connections[0]?.connectionId).toBe("ollama");
  expect(settings.availableModels[0]).toMatchObject({
    templateId: "ollama",
    connectionId: "ollama",
    modelId: "legacy-model",
    enabled: true,
  });
  expect(loadModelConfigFromRef(root, { templateId: "ollama", modelId: "legacy-model" })).toMatchObject({
    modelId: "legacy-model",
    baseUrl: "http://127.0.0.1:11434/v1",
    profileId: "ollama",
  });
});
