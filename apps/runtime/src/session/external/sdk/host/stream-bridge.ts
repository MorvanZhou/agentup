import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Api,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";

import { agentSdkStateOf } from "../../../../config/provider/index.js";
import type { WorkerResult } from "../contract.js";
import { driverIdOfTemplate, getExternalDriver, installedCliPathFor } from "../registry.js";
import { classifyAgentSdkFailure, markAgentSdkFailure } from "./failures.js";
import { openExternalMcp } from "./mcp.js";
import { transcriptToPrompt } from "./prompt.js";
import { resultFromSdkMessage } from "./result.js";
import { externalContextOf } from "./context-of.js";
import {
  AGENT_SDK_TURN_TIMEOUT_MS,
  type AgentSdkStreamContext,
} from "./types.js";

export type AgentSdkStreamSimple = (
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

const DELTA_CHARS = 240;

/**
 * P1：整回合外包给本地 Agent App，只把最终结果折成一条 assistant 回答。
 * 走 registry driver，不直接 import 厂商模块。
 */
export function createAgentSdkStreamSimple(ctx: AgentSdkStreamContext): AgentSdkStreamSimple {
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const partial: AssistantMessage = baseMessage(model, ctx, {
      finalText: "",
      finishReason: "completed",
      permissionDenials: 0,
    });
    partial.content = [];
    partial.stopReason = "pending";
    stream.push({ type: "start", partial: { ...partial } });
    void run(model, context, options, stream, partial);
    return stream;
  };

  async function run(
    model: Model<Api>,
    context: TranscriptContext,
    options: SimpleStreamOptions | undefined,
    stream: AssistantMessageEventStream,
    partial: AssistantMessage,
  ): Promise<void> {
    const controller = new AbortController();
    const signal = options?.signal;
    const onAbort = () => controller.abort();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    const timeoutMs = ctx.turnTimeoutMs ?? AGENT_SDK_TURN_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    let mcpClose: (() => Promise<void>) | undefined;
    try {
      const state = agentSdkStateOf(ctx.userDataRoot, ctx.templateId);
      if (state && state !== "ready") {
        finish(
          stream,
          partial,
          failureResult(classifyAgentSdkFailure("", state), `当前状态：${state}`),
          model,
          ctx,
        );
        return;
      }

      const driver = getExternalDriver(driverIdOfTemplate(ctx.templateId));
      const mcp = await openExternalMcp(ctx);
      mcpClose = mcp?.close;
      const external = externalContextOf(ctx);
      const handle = await driver.startTurn({
        prompt: transcriptToPrompt(context.messages),
        cwd: ctx.cwd,
        additionalDirs: external?.additionalDirs ?? [],
        systemAppend: external?.systemAppend ?? "",
        ...(ctx.modelId && ctx.modelId !== "default" ? { modelId: ctx.modelId } : {}),
        ...(mcp?.clientConfig ? { mcpServer: mcp.clientConfig } : {}),
        abortController: controller,
        ...(ctx.askUser
          ? {
              askUser: {
                request: async (req, signal) =>
                  ctx.askUser!.request(
                    {
                      userId: req.userId,
                      agentId: req.agentId,
                      toolCallId: req.toolCallId,
                      questions: req.questions as never,
                    },
                    signal,
                  ),
              },
            }
          : {}),
        ...(ctx.userId ? { userId: ctx.userId } : {}),
        ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
        cliPath: installedCliPathFor(ctx.userDataRoot, ctx.templateId),
        userDataRoot: ctx.userDataRoot,
        templateId: ctx.templateId,
      });

      const normalize = driver.normalizeResult ?? resultFromSdkMessage;
      let result: WorkerResult | null = null;
      const iterate = (async () => {
        for await (const message of handle.messages) {
          result = normalize(message);
          if (result) break;
        }
      })();
      const winner = await Promise.race([iterate.then(() => "done" as const), guard]);
      if (winner === "timeout") {
        controller.abort();
        handle.abort();
        await Promise.resolve(handle.close()).catch(() => undefined);
        finish(
          stream,
          partial,
          failureResult("timeout", `${Math.round(timeoutMs / 60_000)} 分钟`),
          model,
          ctx,
        );
        return;
      }
      if (signal?.aborted) {
        finish(stream, partial, { finalText: "", finishReason: "aborted", permissionDenials: 0 }, model, ctx);
        return;
      }
      const found = result as WorkerResult | null;
      if (found && found.finishReason === "error") {
        finish(stream, partial, { ...found, error: classifyError(found) }, model, ctx);
        return;
      }
      finish(stream, partial, found ?? failureResult("unknown", "外部 agent 没有返回结果"), model, ctx);
      await Promise.resolve(handle.close()).catch(() => undefined);
    } catch (error) {
      const aborted = Boolean(signal?.aborted) || isAbort(error);
      if (aborted) {
        finish(stream, partial, { finalText: "", finishReason: "aborted", permissionDenials: 0 }, model, ctx);
        return;
      }
      finish(
        stream,
        partial,
        failureResult(classifyAgentSdkFailure(textOf(error)), textOf(error)),
        model,
        ctx,
      );
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      void mcpClose?.().catch(() => undefined);
    }
  }
}

function failureResult(
  code: import("./failures.js").AgentSdkFailureCode,
  detail: string,
): WorkerResult {
  return {
    finalText: "",
    finishReason: "error",
    permissionDenials: 0,
    error: { code, message: markAgentSdkFailure(code, detail) },
  };
}

function classifyError(result: WorkerResult): WorkerResult["error"] {
  const code = classifyAgentSdkFailure(result.error?.message ?? "");
  return { code, message: markAgentSdkFailure(code, result.error?.message ?? "") };
}

function finish(
  stream: AssistantMessageEventStream,
  partial: AssistantMessage,
  result: WorkerResult,
  model: Model<Api>,
  ctx: AgentSdkStreamContext,
): void {
  if (result.permissionDenials > 0) {
    console.error(`[runtime] 外部 agent 有 ${result.permissionDenials} 个操作未获授权被跳过`);
  }
  if (result.finishReason === "completed") {
    const total = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
    console.error(
      `[runtime] 本地 Agent App 本轮：${result.numTurns ?? "?"} 轮 / ${total} tokens / ${result.usage?.durationMs ?? "?"} ms`,
    );
  }
  const message = baseMessage(model, ctx, result);
  message.stopReason =
    result.finishReason === "completed"
      ? "stop"
      : result.finishReason === "max_tokens"
        ? "length"
        : result.finishReason;
  if (result.error) message.errorMessage = result.error.message;
  if (result.sessionId) message.responseId = result.sessionId;

  if (result.finishReason === "error" || result.finishReason === "aborted") {
    stream.push({ type: "error", reason: result.finishReason, error: message });
    stream.end(message);
    return;
  }
  const block = { type: "text" as const, text: "" };
  partial.content = [block];
  stream.push({
    type: "text_start",
    contentIndex: 0,
    partial: { ...partial, content: [{ ...block }] },
  });
  for (const chunk of splitChunks(result.finalText)) {
    block.text += chunk;
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: chunk,
      partial: { ...partial, content: [{ ...block }] },
    });
  }
  stream.push({
    type: "text_end",
    contentIndex: 0,
    content: block.text,
    partial: { ...partial, content: [{ ...block }] },
  });
  stream.push({ type: "done", reason: message.stopReason as "stop" | "length", message });
  stream.end(message);
}

function baseMessage(
  model: Model<Api>,
  ctx: AgentSdkStreamContext,
  result: WorkerResult,
): AssistantMessage {
  const usage = result.usage ?? {};
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  return {
    role: "assistant",
    content: result.finalText ? [{ type: "text", text: result.finalText }] : [],
    api: model.api,
    provider: ctx.providerId,
    model: ctx.modelId,
    usage: {
      input,
      output,
      cacheRead,
      cacheWrite,
      totalTokens: input + output + cacheRead + cacheWrite,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function splitChunks(text: string): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += DELTA_CHARS) {
    chunks.push(text.slice(index, index + DELTA_CHARS));
  }
  return chunks;
}

function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "AbortError";
}

function textOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "外部 agent 调用失败";
}
