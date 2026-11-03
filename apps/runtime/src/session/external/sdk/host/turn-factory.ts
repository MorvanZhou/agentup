import { agentSdkStateOf } from "../../../../config/provider/index.js";
import type { ExternalTurnRequest } from "../contract.js";
import { driverIdOfTemplate, getExternalDriver, installedCliPathFor } from "../registry.js";
import { externalContextOf } from "./context-of.js";
import { openExternalMcp } from "./mcp.js";
import { AGENT_SDK_TURN_TIMEOUT_MS, type AgentSdkStreamContext, type ExternalAgentQuery } from "./types.js";

/**
 * 路 2 入口：Host 重拼上下文 → registry driver.startTurn。
 * 不认具体厂商 API；失败抛出，由调用方决定是否回落 P1。
 */
export async function queryExternalAgent(
  ctx: AgentSdkStreamContext,
  prompt: string,
): Promise<ExternalAgentQuery> {
  const state = agentSdkStateOf(ctx.userDataRoot, ctx.templateId);
  if (state && state !== "ready") throw new Error(`本地 Agent App 当前状态：${state}`);

  const driver = getExternalDriver(driverIdOfTemplate(ctx.templateId));
  const controller = new AbortController();
  const mcp = await openExternalMcp(ctx);
  const external = externalContextOf(ctx);
  const request: ExternalTurnRequest = {
    prompt,
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
  };

  const handle = await driver.startTurn(request);
  return {
    iterable: handle.messages,
    controller,
    timeoutMs: ctx.turnTimeoutMs ?? AGENT_SDK_TURN_TIMEOUT_MS,
    close: async () => {
      await Promise.resolve(handle.close()).catch(() => undefined);
      await mcp?.close().catch(() => undefined);
    },
  };
}

