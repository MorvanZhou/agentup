import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelConfig } from "../src/config/load.js";
import { FILE_VERSION } from "../src/config/provider/constants.js";
import { setRuntimeProviderSecrets } from "../src/config/provider/secrets.js";
import { persist } from "../src/config/provider/store.js";
import {
  createCompactSummarize,
  isOpenAiCompatApiModel,
  pickApiModelConfig,
  resolveApiModelConfig,
  summarizeViaApiModel,
  summarizeViaModelRuntime,
  summarizeViaOpenAiCompat,
} from "../src/session/external/sdk/host/summarize.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
  setRuntimeProviderSecrets({ "custom-openai": "" });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-compact-"));
  roots.push(root);
  return root;
}

function apiModel(partial: Partial<ModelConfig> = {}): ModelConfig {
  return {
    providerId: "custom-openai",
    templateId: "custom-openai",
    modelId: "gpt-test",
    apiKey: "sk-test",
    baseUrl: "https://example.test/v1",
    kind: "custom-openai",
    ...partial,
  };
}

describe("provider 亲和：createCompactSummarize", () => {
  it("SDK prefer 时绝不改用本机 Ollama API 压缩", () => {
    const root = tempRoot();
    persist(root, {
      version: FILE_VERSION,
      connections: [
        {
          templateId: "ollama",
          baseUrl: "http://127.0.0.1:11434/v1",
          customModelIds: ["qwen3:4b"],
        },
      ],
      enabledModels: [
        { templateId: "codebuddy-sdk", modelId: "claude-sonnet-5" },
        { templateId: "ollama", modelId: "qwen3:4b" },
      ],
      activeModel: { templateId: "codebuddy-sdk", modelId: "claude-sonnet-5" },
      agentSdks: [
        {
          templateId: "codebuddy-sdk",
          state: "ready",
          models: [{ id: "claude-sonnet-5", name: "Sonnet" }],
        },
      ],
    });
    const prefer: ModelConfig = {
      providerId: "codebuddy",
      templateId: "codebuddy-sdk",
      modelId: "claude-sonnet-5",
      apiKey: "placeholder",
      kind: "agent-sdk",
    };
    // 不得因有 ollama 而返回 API 摘要器；应走 SDK compact（codebuddy 已接）
    expect(pickApiModelConfig(root, prefer)).toBeNull();
    expect(createCompactSummarize({ userDataRoot: root, prefer })).toBeTypeOf("function");
  });

  it("API prefer 只用该模型，不扫其它 enabled", () => {
    const root = tempRoot();
    persist(root, {
      version: FILE_VERSION,
      connections: [
        {
          templateId: "ollama",
          baseUrl: "http://127.0.0.1:11434/v1",
          customModelIds: ["qwen3:4b", "llama3.2"],
        },
      ],
      enabledModels: [
        { templateId: "ollama", modelId: "qwen3:4b" },
        { templateId: "ollama", modelId: "llama3.2" },
      ],
      activeModel: { templateId: "ollama", modelId: "llama3.2" },
      agentSdks: [],
    });
    const prefer = apiModel({
      templateId: "ollama",
      modelId: "llama3.2",
      providerId: "ollama",
      kind: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "ollama",
    });
    expect(isOpenAiCompatApiModel(prefer)).toBe(true);
    expect(pickApiModelConfig(root, prefer)?.modelId).toBe("llama3.2");
    expect(createCompactSummarize({ userDataRoot: root, prefer })).toBeTypeOf("function");
  });

  it("无 prefer 时不猜模型", () => {
    const root = tempRoot();
    persist(root, {
      version: FILE_VERSION,
      connections: [
        {
          templateId: "ollama",
          baseUrl: "http://127.0.0.1:11434/v1",
          customModelIds: ["qwen3:4b"],
        },
      ],
      enabledModels: [{ templateId: "ollama", modelId: "qwen3:4b" }],
      activeModel: { templateId: "ollama", modelId: "qwen3:4b" },
      agentSdks: [],
    });
    expect(createCompactSummarize({ userDataRoot: root })).toBeUndefined();
  });

  it("pi-native prefer 也返回摘要器（走 ModelRuntime，非仅 openai-completions）", () => {
    const root = tempRoot();
    const prefer: ModelConfig = {
      providerId: "anthropic",
      templateId: "anthropic",
      modelId: "claude-sonnet-4-5",
      apiKey: "sk-ant-test",
      kind: "pi-native",
      contextWindow: 200_000,
    };
    expect(isOpenAiCompatApiModel(prefer)).toBe(false);
    expect(resolveApiModelConfig(root, prefer)?.modelId).toBe("claude-sonnet-4-5");
    expect(pickApiModelConfig(root, prefer)).toBeNull();
    expect(createCompactSummarize({ userDataRoot: root, prefer })).toBeTypeOf("function");
  });
});

describe("summarizeViaOpenAiCompat", () => {
  it("把 chat/completions 正文当作摘要", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "  压缩后的要点  " } }],
            }),
            { status: 200 },
          ),
      ),
    );
    const summary = await summarizeViaOpenAiCompat(apiModel(), "很长的历史……");
    expect(summary).toBe("压缩后的要点");
    expect(fetch).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("summarizeViaModelRuntime", () => {
  it("从 completeSimple 助手正文取出摘要", async () => {
    const runtimeMod = await import("../src/session/model/runtime.js");
    const openSpy = vi.spyOn(runtimeMod, "openModelRuntime").mockResolvedValue({
      runtime: {
        completeSimple: async () =>
          ({
            role: "assistant",
            content: [{ type: "text", text: "  原生摘要  " }],
            stopReason: "stop",
            errorMessage: undefined,
          }) as never,
      },
      model: { id: "claude-sonnet-4-5", contextWindow: 200_000 },
    } as never);
    try {
      const summary = await summarizeViaModelRuntime(
        {
          providerId: "anthropic",
          templateId: "anthropic",
          modelId: "claude-sonnet-4-5",
          apiKey: "sk-ant-test",
          kind: "pi-native",
        },
        "很长的历史……",
      );
      expect(summary).toBe("原生摘要");
      expect(openSpy).toHaveBeenCalledOnce();
    } finally {
      openSpy.mockRestore();
    }
  });
});

describe("summarizeViaApiModel", () => {
  it("ModelRuntime 失败时回落 OpenAI 兼容 HTTP", async () => {
    const runtimeMod = await import("../src/session/model/runtime.js");
    const openSpy = vi
      .spyOn(runtimeMod, "openModelRuntime")
      .mockRejectedValue(new Error("runtime boom"));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { content: "HTTP摘要" } }] }),
            { status: 200 },
          ),
      ),
    );
    try {
      const summary = await summarizeViaApiModel(apiModel(), "历史");
      expect(summary).toBe("HTTP摘要");
    } finally {
      openSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
