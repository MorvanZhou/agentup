import { startExternalMcpServer, type McpTool } from "../../mcp/server.js";
import type { AgentSdkStreamContext } from "./types.js";

export type OpenedExternalMcp = {
  clientConfig: Record<string, unknown>;
  close: () => Promise<void>;
};

/**
 * 起一轮专用的 MCP 端点：只监听 127.0.0.1 + 随机 token，回合结束就关。
 * 起不来不算致命：没有委托工具，外部 agent 照样能干活。
 */
export async function openExternalMcp(ctx: AgentSdkStreamContext): Promise<OpenedExternalMcp | null> {
  if (!ctx.mcpTools || ctx.mcpTools.length === 0) return null;
  try {
    const server = await startExternalMcpServer({ tools: ctx.mcpTools, serverName: "agentup" });
    return {
      clientConfig: { type: "http", url: server.url, headers: server.headers },
      close: () => server.close().catch(() => undefined),
    };
  } catch (error) {
    console.error(`[runtime] 外部 agent 的 MCP 通道没起来：${textOf(error)}`);
    return null;
  }
}

function textOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "未知原因";
}

export type { McpTool };
