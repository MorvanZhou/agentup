/**
 * SDK contextWindow → model-catalog → ModelConfig → 压缩预算。
 * 规格：list-models.md §4.1 / §4.2；agent-context-compaction.md。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONTEXT_WINDOW,
  readCatalogEntry,
  resolveModelLimits,
} from "../src/config/model-catalog.js";
import {
  loadModelConfigFromRef,
  setAgentSdkModels,
  setAgentSdkState,
  setModelEnabled,
} from "../src/config/provider/index.js";
import { normalizeCodebuddyModels } from "../src/session/external/sdk/adapters/codebuddy/index.js";
import {
  compactBudgetsFromContextWindow,
  compactTurnOptions,
} from "../src/session/model/agent-sdk.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentup-sdk-catalog-cw-"));
}

describe("SDK catalog contextWindow → compact budgets", () => {
  it("setAgentSdkModels 写入 catalog；loadModelConfig / compactTurnOptions 用该窗而非 128k", () => {
    const root = tempRoot();
    setAgentSdkState(root, "codebuddy-sdk", "ready", { installedVersion: "0.0.0-test" });
    setAgentSdkModels(root, "codebuddy-sdk", [
      {
        id: "claude-sonnet-test",
        name: "Claude Sonnet Test",
        contextWindow: 200_000,
        maxTokens: 64_000,
      },
    ]);

    expect(readCatalogEntry(root, "codebuddy-sdk", "claude-sonnet-test")).toEqual({
      name: "Claude Sonnet Test",
      contextWindow: 200_000,
      maxTokens: 64_000,
    });
    expect(resolveModelLimits(root, "codebuddy-sdk", "claude-sonnet-test").contextWindow).toBe(
      200_000,
    );

    setModelEnabled(root, { templateId: "codebuddy-sdk", modelId: "claude-sonnet-test" }, true);
    const model = loadModelConfigFromRef(root, {
      templateId: "codebuddy-sdk",
      modelId: "claude-sonnet-test",
    });
    expect(model.contextWindow).toBe(200_000);
    expect(model.maxTokens).toBe(64_000);

    const budgets = compactBudgetsFromContextWindow(model.contextWindow);
    expect(budgets.contextWindowTokens).toBe(200_000);
    expect(budgets.triggerChars).toBe(
      compactBudgetsFromContextWindow(200_000).triggerChars,
    );
    expect(budgets.triggerChars).not.toBe(
      compactBudgetsFromContextWindow(DEFAULT_CONTEXT_WINDOW).triggerChars,
    );

    const turn = compactTurnOptions({ userDataRoot: root, prefer: model });
    expect(turn.compactBudgetChars).toBe(budgets.triggerChars);
    expect(turn.promptMaxChars).toBe(budgets.hardTruncateChars);
  });

  it("无窗口字段时 catalog / 预算回落 DEFAULT_CONTEXT_WINDOW", () => {
    const root = tempRoot();
    setAgentSdkState(root, "codebuddy-sdk", "ready", { installedVersion: "0.0.0-test" });
    setAgentSdkModels(root, "codebuddy-sdk", [
      { id: "no-window-model", name: "No Window" },
    ]);
    expect(readCatalogEntry(root, "codebuddy-sdk", "no-window-model")?.contextWindow).toBe(
      DEFAULT_CONTEXT_WINDOW,
    );
    setModelEnabled(root, { templateId: "codebuddy-sdk", modelId: "no-window-model" }, true);
    const model = loadModelConfigFromRef(root, {
      templateId: "codebuddy-sdk",
      modelId: "no-window-model",
    });
    expect(model.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(compactTurnOptions({ userDataRoot: root, prefer: model }).compactBudgetChars).toBe(
      compactBudgetsFromContextWindow(DEFAULT_CONTEXT_WINDOW).triggerChars,
    );
  });

  it("CodeBuddy normalize：maxInputTokens 优先；否则 contextWindow.defaultLength", () => {
    expect(
      normalizeCodebuddyModels([
        { modelId: "a", name: "A", maxInputTokens: 180_000, maxOutputTokens: 8_000 },
        {
          id: "b",
          name: "B",
          contextWindow: { defaultLength: 256_000 },
        },
        { id: "c", name: "C", maxInputTokens: 100_000, contextWindow: { defaultLength: 999_999 } },
      ]),
    ).toEqual([
      { id: "a", name: "A", contextWindow: 180_000, maxTokens: 8_000 },
      { id: "b", name: "B", contextWindow: 256_000 },
      { id: "c", name: "C", contextWindow: 100_000 },
    ]);
  });
});
