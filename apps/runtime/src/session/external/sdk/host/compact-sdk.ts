/**
 * 无 OpenAI 兼容 API 时：用当前 agent-sdk 开受限压缩回合。
 * 规格：agent-context-compaction.md §5.2；契约 ExternalCompactRequest。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ModelConfig } from "../../../../config/load.js";
import { getProviderTemplate } from "../../../../config/provider-templates.js";
import type { ExternalCompactRequest, ExternalDriver } from "../contract.js";
import {
  driverIdOfTemplate,
  getExternalDriver,
  installedCliPathFor,
} from "../registry.js";
import {
  CHARS_PER_TOKEN_ESTIMATE,
  resolveContextWindowTokens,
} from "./budget.js";

/** 待摘要正文占模型窗的比例（字符粗估）；留余量给系统/输出。 */
export const COMPACT_INPUT_WINDOW_RATIO = 0.45;

export { CHARS_PER_TOKEN_ESTIMATE } from "./budget.js";

/** SDK 压缩硬超时；失败即回落硬裁，不重试。 */
export const COMPACT_SDK_TIMEOUT_MS = 45_000;

const COMPACT_TASK_HEADER = `这是一个压缩上下文的任务，不是写代码或调用工具。
目标：把下列对话历史压成一段结构化中文摘要，供后续 agent 继续工作。
保留：目标、已做决策、关键路径/文件、未完成项、用户硬约束。
不要工具过程流水账；不要编造未出现的事实；不要提问。
只输出摘要正文，不要开场白。`;

export type CompactSdkDeps = {
  getExternalDriver: typeof getExternalDriver;
  driverIdOfTemplate: typeof driverIdOfTemplate;
  installedCliPathFor: typeof installedCliPathFor;
};

const defaultDeps: CompactSdkDeps = {
  getExternalDriver,
  driverIdOfTemplate,
  installedCliPathFor,
};

/** 超预算：保留头 40% + 尾部，中间省略（兼顾目标与近况）。 */
export function clipTranscriptForCompact(
  text: string,
  contextWindowTokens: number,
): string {
  const window = Math.max(1, contextWindowTokens);
  const budget = Math.max(
    2_000,
    Math.floor(window * CHARS_PER_TOKEN_ESTIMATE * COMPACT_INPUT_WINDOW_RATIO),
  );
  if (text.length <= budget) return text;
  const marker = "\n\n…(中间已省略)…\n\n";
  const head = Math.floor((budget - marker.length) * 0.4);
  const tail = budget - marker.length - head;
  return `${text.slice(0, Math.max(1, head))}${marker}${text.slice(-Math.max(1, tail))}`;
}

/** 压缩专用 user prompt（任务说明 + 已截窗正文）。 */
export function buildCompactPrompt(clippedTranscript: string): string {
  return `${COMPACT_TASK_HEADER}\n\n---\n\n${clippedTranscript}`;
}

/**
 * 只用会话所选 SDK 模型；不扫其它 enabled（同 provider 亲和）。
 * adaptor 未实现 compactSummarize → null。
 */
export function pickSdkCompactTarget(
  _userDataRoot: string,
  prefer?: ModelConfig | null,
  deps: CompactSdkDeps = defaultDeps,
): { templateId: string; modelId: string; contextWindow: number } | null {
  if (!prefer?.templateId || !prefer.modelId) return null;
  const template = getProviderTemplate(prefer.templateId);
  if (!template || template.access !== "agent-sdk" || !template.agentSdk?.driverId) {
    return null;
  }
  let driver: ExternalDriver;
  try {
    driver = deps.getExternalDriver(deps.driverIdOfTemplate(prefer.templateId));
  } catch {
    return null;
  }
  if (!driver.capabilities.compactSummarize || typeof driver.compactSummarize !== "function") {
    return null;
  }
  return {
    templateId: prefer.templateId,
    modelId: prefer.modelId,
    contextWindow: resolveContextWindowTokens(prefer.contextWindow),
  };
}

/**
 * 若本机有支持 compact 的 SDK，返回摘要函数；否则 undefined。
 * 临时空 cwd，用完删除；失败抛错由 maybeCompactBranch 吞掉。
 */
export function createSdkCompactSummarize(
  input: {
    userDataRoot: string;
    prefer?: ModelConfig | null;
    signal?: AbortSignal;
  },
  deps: CompactSdkDeps = defaultDeps,
): ((plainTranscript: string) => Promise<string>) | undefined {
  const target = pickSdkCompactTarget(input.userDataRoot, input.prefer, deps);
  if (!target) return undefined;

  const driver = deps.getExternalDriver(deps.driverIdOfTemplate(target.templateId));
  const compact = driver.compactSummarize?.bind(driver);
  if (!compact) return undefined;

  const cliPath = deps.installedCliPathFor(input.userDataRoot, target.templateId);

  return async (plainTranscript: string) => {
    const clipped = clipTranscriptForCompact(plainTranscript, target.contextWindow);
    const prompt = buildCompactPrompt(clipped);
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-compact-cwd-"));
    const abortController = new AbortController();
    const timeout = AbortSignal.timeout(COMPACT_SDK_TIMEOUT_MS);
    const onAbort = () => abortController.abort();
    if (input.signal?.aborted) onAbort();
    else input.signal?.addEventListener("abort", onAbort, { once: true });
    timeout.addEventListener("abort", onAbort, { once: true });

    const request: ExternalCompactRequest = {
      prompt,
      cwd,
      modelId: target.modelId,
      abortController,
      userDataRoot: input.userDataRoot,
      templateId: target.templateId,
      ...(cliPath ? { cliPath } : {}),
    };

    try {
      const summary = (await compact(request)).trim();
      if (!summary) throw new Error("compact sdk: empty summary");
      return summary;
    } finally {
      input.signal?.removeEventListener("abort", onAbort);
      try {
        fs.rmSync(cwd, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  };
}
