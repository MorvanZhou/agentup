import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import type { Visit } from "../src/package/sync.js";
import { openModelRuntime } from "../src/session/model/runtime.js";
import { buildSessionPlan } from "../src/session/plan.js";

it("resolves the local model API key without writing Pi auth files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-model-runtime-"));
  const visit: Visit = {
    userId: "patient",
    agentId: "weather",
    root,
    packageVersion: 1,
    packageDigest: "digest",
    tools: ["bash"],
    modelCapabilities: ["tools"],
    projectTrust: "granted",
  };
  const plan = buildSessionPlan(visit, {
    providerId: "ollama",
    templateId: "ollama",
    modelId: "qwen3:0.6b",
    apiKey: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    kind: "ollama",
  });
  const { runtime, model } = await openModelRuntime(plan);
  expect(model).toMatchObject({ id: "qwen3:0.6b", provider: "ollama", baseUrl: "http://127.0.0.1:11434/v1" });
  expect(await runtime.getAuth(model)).toMatchObject({ auth: { apiKey: "ollama" } });
  expect(fs.readdirSync(root)).toEqual([]);
});

it("registers a manually added model id on a pi-native provider", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-model-runtime-native-"));
  const visit: Visit = {
    userId: "patient",
    agentId: "weather",
    root,
    packageVersion: 1,
    packageDigest: "digest",
    tools: ["bash"],
    modelCapabilities: ["tools"],
    projectTrust: "granted",
  };
  const plan = buildSessionPlan(visit, {
    providerId: "zai",
    templateId: "zai",
    modelId: "glm-4.7-flash",
    apiKey: "sk-test",
    kind: "pi-native",
  });
  const { model } = await openModelRuntime(plan);
  expect(model).toMatchObject({
    id: "glm-4.7-flash",
    provider: "zai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
  });
  expect(fs.readdirSync(root)).toEqual([]);
});
