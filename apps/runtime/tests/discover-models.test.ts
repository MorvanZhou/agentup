import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import {
  clearRuntimeProviderSecrets,
  refreshProviderModels,
  setRuntimeProviderSecrets,
  upsertProviderConnection,
} from "../src/config/provider.js";
import { discoverRemoteModels } from "../src/config/discover-models.js";

afterEach(() => {
  vi.unstubAllGlobals();
  clearRuntimeProviderSecrets();
});

it("parses OpenAI-compatible /models payloads", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }, { id: "gpt-4o" }],
      }),
    ),
  );
  await expect(
    discoverRemoteModels({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      kind: "custom-openai",
    }),
  ).resolves.toEqual(["gpt-4o", "gpt-4o-mini"]);
});

it("falls back to Ollama /api/tags when /v1/models is empty", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/models")) return Response.json({ data: [] });
      if (url.endsWith("/api/tags")) {
        return Response.json({ models: [{ name: "qwen3:4b" }, { name: "llama3.2:3b" }] });
      }
      return new Response("missing", { status: 404 });
    }),
  );
  await expect(
    discoverRemoteModels({
      baseUrl: "http://127.0.0.1:11434/v1",
      kind: "ollama",
    }),
  ).resolves.toEqual(["qwen3:4b", "llama3.2:3b"]);
});

it("persists discovered models onto a saved connection", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-discover-"));
  upsertProviderConnection(root, {
    templateId: "custom-openai",
    baseUrl: "https://api.example.com/v1",
    apiKeyCipher: "cipher",
  });
  setRuntimeProviderSecrets({ "custom-openai": "sk-live" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ data: [{ id: "my-model-a" }, { id: "my-model-b" }] })),
  );

  const settings = await refreshProviderModels(root, "custom-openai");
  expect(settings.connections[0]?.discoveredModelIds).toEqual(["my-model-a", "my-model-b"]);
  expect(settings.availableModels.map((m) => m.modelId)).toEqual(["my-model-a", "my-model-b"]);
  expect(settings.activeModel).toEqual({ templateId: "custom-openai", modelId: "my-model-a" });
  expect(settings.availableModels.find((m) => m.modelId === "my-model-a")?.enabled).toBe(true);
});
