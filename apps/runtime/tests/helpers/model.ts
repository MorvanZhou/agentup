import type { ModelConfig } from "../../src/config/load.js";

export function testOllamaModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    providerId: "ollama",
    templateId: "ollama",
    modelId: "qwen",
    apiKey: "ollama",
    baseUrl: "http://localhost:11434/v1",
    kind: "ollama",
    ...overrides,
  };
}
