import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  NO_REASONING_PROFILE,
  resolveReasoningProfile,
} from "../src/config/reasoning-profile.js";
import { openModelRuntime } from "../src/session/model/runtime.js";
import { buildSessionPlan } from "../src/session/plan.js";
import type { Visit } from "../src/package/sync.js";

it("maps Hunyuan / hy4 so off → no_think (official template enum)", () => {
  const profile = resolveReasoningProfile("hy4-preview", "tencent-tokenhub");
  expect(profile.reasoning).toBe(true);
  expect(profile.supportsReasoningEffort).toBe(true);
  expect(profile.thinkingLevelMap?.off).toBe("no_think");
  expect(profile.thinkingLevelMap?.high).toBe("high");
  expect(profile.thinkingFormat).toBeUndefined();
});

it("maps DeepSeek and Qwen thinking families to their wire formats", () => {
  expect(resolveReasoningProfile("deepseek-v4-pro")).toMatchObject({
    reasoning: true,
    thinkingFormat: "deepseek",
    supportsReasoningEffort: true,
  });
  expect(resolveReasoningProfile("deepseek-v4-pro").thinkingLevelMap?.off).toBe("none");

  expect(resolveReasoningProfile("qwen3-235b")).toMatchObject({
    reasoning: true,
    thinkingFormat: "qwen",
  });
});

it("maps OpenAI o-series / gpt-5 style ids", () => {
  expect(resolveReasoningProfile("o3-mini").thinkingLevelMap?.off).toBe("none");
  expect(resolveReasoningProfile("gpt-5.1").reasoning).toBe(true);
});

it("leaves unknown chat models without reasoning params", () => {
  expect(resolveReasoningProfile("llama3.2")).toEqual(NO_REASONING_PROFILE);
  expect(resolveReasoningProfile("my-finetune-v1")).toEqual(NO_REASONING_PROFILE);
});

it("registers hy4 on TokenHub with reasoning profile for session open", async () => {
  const visitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-reason-visit-"));
  const visit: Visit = {
    userId: "u",
    agentId: "a",
    root: visitRoot,
    packageVersion: 1,
    packageDigest: "d",
    tools: ["bash"],
    modelCapabilities: ["tools"],
    projectTrust: "granted",
  };
  const plan = buildSessionPlan(visit, {
    providerId: "tencent-tokenhub",
    templateId: "tencent-tokenhub",
    modelId: "hy4-preview",
    apiKey: "sk-test",
    baseUrl: "https://tokenhub.tencentmaas.com/v1",
    kind: "custom-openai",
    contextWindow: 128_000,
    maxTokens: 16_384,
  });
  const opened = await openModelRuntime(plan);
  expect(opened.model.reasoning).toBe(true);
  expect(opened.model.thinkingLevelMap?.off).toBe("no_think");
  expect(opened.model.compat?.supportsReasoningEffort).toBe(true);
});
