import { expect, it } from "vitest";

import { applyDefaultSampling, createDefaultSamplingExtension } from "../src/session/sampling.js";

it("stamps temperature and top_p onto OpenAI-style and Anthropic payloads", () => {
  expect(
    applyDefaultSampling({
      model: "glm-5.2",
      messages: [],
      temperature: 0.2,
      max_tokens: 128,
    }),
  ).toEqual({
    model: "glm-5.2",
    messages: [],
    temperature: 1,
    top_p: 0.95,
    max_tokens: 128,
  });
});

it("stamps Google and Vertex config fields", () => {
  expect(
    applyDefaultSampling({
      model: "gemini-2.5-flash",
      contents: [],
      config: { maxOutputTokens: 64 },
    }),
  ).toEqual({
    model: "gemini-2.5-flash",
    contents: [],
    config: { maxOutputTokens: 64, temperature: 1, topP: 0.95 },
  });
});

it("stamps Bedrock inferenceConfig", () => {
  expect(
    applyDefaultSampling({
      modelId: "anthropic.claude",
      messages: [],
      inferenceConfig: { maxTokens: 32 },
    }),
  ).toEqual({
    modelId: "anthropic.claude",
    messages: [],
    inferenceConfig: { maxTokens: 32, temperature: 1, topP: 0.95 },
  });
});

it("stamps pi-messages options", () => {
  expect(
    applyDefaultSampling({
      model: "pi",
      context: { messages: [] },
      options: { maxTokens: 16 },
    }),
  ).toEqual({
    model: "pi",
    context: { messages: [] },
    options: { maxTokens: 16, temperature: 1, top_p: 0.95 },
  });
});

it("leaves non-objects unchanged", () => {
  expect(applyDefaultSampling(undefined)).toBeUndefined();
  expect(applyDefaultSampling("raw")).toBe("raw");
});

it("extension returns the stamped provider payload", () => {
  const factory = createDefaultSamplingExtension();
  const handlers = new Map<string, (event: { payload: unknown }) => unknown>();
  factory({
    on(event: string, handler: (event: { payload: unknown }) => unknown) {
      handlers.set(event, handler);
      return () => undefined;
    },
  } as never);

  const result = handlers.get("before_provider_request")!({
    payload: { model: "qwen", messages: [] },
  });
  expect(result).toEqual({ model: "qwen", messages: [], temperature: 1, top_p: 0.95 });
});
