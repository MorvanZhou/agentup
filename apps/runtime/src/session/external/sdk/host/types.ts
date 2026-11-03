import type { Visit } from "../../../../package/sync.js";
import type { WorkspacePolicy } from "../../../context/workspace-policy.js";
import type { McpTool } from "../../mcp/server.js";
import type { AskUserAnswer, AskUserQuestion } from "../../../tools/ask-user.js";

/** 审批通道（ApprovalBroker 的最小面）；SDK 信任模式下通常不再 request。 */
export interface AgentSdkApprovalSink {
  request(
    request: {
      userId: string;
      agentId: string;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      allowKey?: string;
    },
    signal?: AbortSignal,
  ): Promise<boolean | undefined>;
  allowsTool?(toolName: string): boolean;
}

/** SDK 的 AskUser 不是权限审批：宿主必须收集答案并回填。 */
export interface AgentSdkAskUserSink {
  request(
    request: {
      userId: string;
      agentId: string;
      toolCallId: string;
      questions: AskUserQuestion[];
    },
    signal?: AbortSignal,
  ): Promise<AskUserAnswer>;
}

/** 会话侧组装外部回合所需的上下文（Host 持有，再映射成 ExternalTurnRequest）。 */
export type AgentSdkStreamContext = {
  userDataRoot: string;
  templateId: string;
  providerId: string;
  modelId: string;
  cwd: string;
  approvals?: AgentSdkApprovalSink;
  askUser?: AgentSdkAskUserSink;
  userId?: string;
  agentId?: string;
  turnTimeoutMs?: number;
  visit?: Visit;
  workspacePolicy?: WorkspacePolicy;
  groupId?: string;
  groupWorkspaceRoot?: string;
  agentName?: string;
  groupRosterPrompt?: string;
  mcpTools?: McpTool[];
};

/** 路 2：交给 runExternalTurn 的流句柄。 */
export type ExternalAgentQuery = {
  iterable: AsyncIterable<unknown>;
  controller: AbortController;
  timeoutMs: number;
  close?: () => Promise<void>;
};

/** 整回合上限：外部 agent 可能长时间不给结果。 */
export const AGENT_SDK_TURN_TIMEOUT_MS = 10 * 60_000;

/** Pi 自定义 api 名；与模板 models[].api 一致。 */
export const AGENT_SDK_API = "agentup-agent-sdk";
