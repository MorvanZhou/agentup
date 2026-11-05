/**
 * Host 压缩摘要：只用**当前会话所选**模型（同 provider）。
 * - API 会话 → 同模型补全（OpenAI 兼容走 HTTP；pi-native 等走 ModelRuntime.completeSimple）
 * - SDK 会话 → 该 SDK 受限 compactSummarize
 * 禁止跨 provider（例如 SDK 对话却用本机 Ollama 压）。
 * 规格：agent-context-compaction.md
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ModelConfig } from "../../../../config/load.js";
import { loadModelConfigFromRef } from "../../../../config/provider/model-config.js";
import { getProviderTemplate } from "../../../../config/provider-templates.js";
import { detectHostEnvironment } from "../../../environment.js";
import type { SessionPlan } from "../../../plan.js";
import { resolveContextWindowTokens } from "./budget.js";
import { clipTranscriptForCompact, createSdkCompactSummarize } from "./compact-sdk.js";

const SUMMARIZE_TIMEOUT_MS = 60_000;

const COMPACT_INSTRUCTION = `你是会话压缩器。把下列对话历史压成一段结构化中文摘要，供后续 agent 继续工作。
保留：目标、已做决策、关键路径/文件、未完成项、用户硬约束。
不要工具过程流水账；不要编造未出现的事实。直接输出摘要正文，不要开场白。`;

/** 是否适合用 HTTP OpenAI 兼容接口做短补全。 */
export function isOpenAiCompatApiModel(config: ModelConfig): boolean {
  const template = getProviderTemplate(config.templateId);
  if (!template || template.access === "agent-sdk") return false;
  const api = template.api ?? "";
  return (
    api === "openai-completions" ||
    config.kind === "ollama" ||
    config.kind === "custom-openai" ||
    config.kind === "volcengine-ark"
  );
}

/** 任意 API 模型（含 pi-native）；SDK 返回 null。 */
export function resolveApiModelConfig(
  userDataRoot: string,
  prefer?: ModelConfig | null,
): ModelConfig | null {
  if (!prefer?.templateId || !prefer.modelId) return null;
  const template = getProviderTemplate(prefer.templateId);
  if (!template || template.access === "agent-sdk") return null;
  try {
    return loadModelConfigFromRef(userDataRoot, {
      templateId: prefer.templateId,
      modelId: prefer.modelId,
    });
  } catch {
    // 连接未就绪时仍可用 prefer 内存里的密钥/地址（测试与冷路径）
    if (prefer.baseUrl || prefer.apiKey) return prefer;
    return null;
  }
}

/**
 * 解析会话所选 OpenAI 兼容 API 模型（仅 prefer，不扫其它 enabled）。
 * @deprecated 名称保留给测例；新代码用 createCompactSummarize / resolveApiModelConfig。
 */
export function pickApiModelConfig(
  userDataRoot: string,
  prefer?: ModelConfig | null,
): ModelConfig | null {
  const config = resolveApiModelConfig(userDataRoot, prefer);
  if (!config || !isOpenAiCompatApiModel(config)) return null;
  return config;
}

/** 调 OpenAI 兼容 chat/completions；失败抛错由 maybeCompactBranch 吞掉。 */
export async function summarizeViaOpenAiCompat(
  config: ModelConfig,
  plainTranscript: string,
  signal?: AbortSignal,
): Promise<string> {
  const base = (config.baseUrl ?? "").replace(/\/$/, "");
  if (!base) throw new Error("compact summarize: missing baseUrl");
  const window = resolveContextWindowTokens(config.contextWindow);
  const body = clipTranscriptForCompact(plainTranscript, window);
  const url = `${base}/chat/completions`;
  const timeout = AbortSignal.timeout(SUMMARIZE_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.modelId,
      temperature: 0.2,
      max_tokens: 1024,
      messages: [
        { role: "system", content: COMPACT_INSTRUCTION },
        { role: "user", content: body },
      ],
    }),
    signal: combined,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`compact summarize HTTP ${response.status}: ${detail.slice(0, 200)}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => (part.type === "text" ? part.text ?? "" : "")).join("")
        : "";
  const trimmed = text.trim();
  if (!trimmed) throw new Error("compact summarize: empty completion");
  return trimmed;
}

/**
 * pi-native / 非 OpenAI 兼容 API：经 ModelRuntime.completeSimple 同模型摘要。
 * 动态 import 避免与 model/runtime ↔ agent-sdk 门面循环依赖。
 */
export async function summarizeViaModelRuntime(
  config: ModelConfig,
  plainTranscript: string,
  signal?: AbortSignal,
): Promise<string> {
  const { openModelRuntime } = await import("../../../model/runtime.js");
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-compact-api-"));
  const timeout = AbortSignal.timeout(SUMMARIZE_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const plan: SessionPlan = {
      cwd,
      sessionDir: path.join(cwd, "sessions"),
      agentDir: path.join(cwd, ".runtime"),
      tools: [],
      mcp: false,
      provider: {
        templateId: config.templateId,
        providerId: config.providerId,
        modelId: config.modelId,
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
        kind: config.kind,
        ...(typeof config.contextWindow === "number"
          ? { contextWindow: config.contextWindow }
          : {}),
        ...(typeof config.maxTokens === "number" ? { maxTokens: config.maxTokens } : {}),
      },
      // 摘要不启工具；环境仅满足 SessionPlan 类型
      environment: detectHostEnvironment({
        bashAvailable: false,
        powershellAvailable: false,
      }),
    };
    const { runtime, model } = await openModelRuntime(plan);
    const window = resolveContextWindowTokens(config.contextWindow);
    const body = clipTranscriptForCompact(plainTranscript, window);
    const assistant = await runtime.completeSimple(
      model,
      {
        systemPrompt: COMPACT_INSTRUCTION,
        messages: [{ role: "user", content: body, timestamp: Date.now() }],
      },
      {
        maxTokens: 1024,
        temperature: 0.2,
        apiKey: config.apiKey,
        signal: combined,
      },
    );
    if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
      throw new Error(
        `compact summarize: ${assistant.errorMessage ?? assistant.stopReason}`,
      );
    }
    const text = assistant.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    if (!text) throw new Error("compact summarize: empty completion");
    return text;
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

/**
 * API 同模型摘要：优先 ModelRuntime（与主聊天同一套注册/鉴权），
 * OpenAI 兼容再回落裸 fetch（兼容测例与无 runtime 场景）。
 */
export async function summarizeViaApiModel(
  config: ModelConfig,
  plainTranscript: string,
  signal?: AbortSignal,
): Promise<string> {
  try {
    return await summarizeViaModelRuntime(config, plainTranscript, signal);
  } catch (primary) {
    if (!isOpenAiCompatApiModel(config) || !config.baseUrl) throw primary;
    return await summarizeViaOpenAiCompat(config, plainTranscript, signal);
  }
}

/**
 * 按会话模型选压缩器：同 template / 同 access，绝不跨 provider。
 * 无 prefer、或该模型无法摘要 → undefined（拼装硬裁）。
 */
export function createCompactSummarize(input: {
  userDataRoot: string;
  prefer?: ModelConfig | null;
  signal?: AbortSignal;
}): ((plainTranscript: string) => Promise<string>) | undefined {
  const prefer = input.prefer;
  if (!prefer?.templateId || !prefer.modelId) return undefined;

  const template = getProviderTemplate(prefer.templateId);
  if (!template) return undefined;

  if (template.access === "agent-sdk") {
    return createSdkCompactSummarize(input);
  }

  // 会话 prefer 已能开聊时优先沿用其密钥；resolve 仅用于补全落盘配置
  const resolved = resolveApiModelConfig(input.userDataRoot, prefer);
  const config = resolved ?? (prefer.apiKey || prefer.baseUrl ? prefer : null);
  if (!config?.apiKey) return undefined;

  return (plainTranscript) =>
    summarizeViaApiModel(config, plainTranscript, input.signal);
}
