import type { ExternalTurnRequest } from "../../contract.js";

export const OPENCODE_CONTEXT_HEADER = [
  "You are running as a local OpenCode agent hosted inside AgentUp.",
  "Follow the AgentUp context below. Prefer the listed tools and authorized directories.",
].join("\n");

export function opencodeModelOf(
  modelId?: string,
): { providerID: string; modelID: string } | undefined {
  if (!modelId || modelId === "default") return undefined;
  const slash = modelId.indexOf("/");
  if (slash > 0 && slash < modelId.length - 1) {
    return {
      providerID: modelId.slice(0, slash),
      modelID: modelId.slice(slash + 1),
    };
  }
  return { providerID: "opencode", modelID: modelId };
}

export function opencodePromptBodyOf(input: ExternalTurnRequest): Record<string, unknown> {
  return {
    ...(opencodeModelOf(input.modelId)
      ? { model: opencodeModelOf(input.modelId) }
      : {}),
    // v2 prompt 支持 system；保留 OpenCode 默认系统提示，只追加 Host 上下文。
    system: input.systemAppend.trim()
      ? `${OPENCODE_CONTEXT_HEADER}\n\n${input.systemAppend.trim()}`
      : OPENCODE_CONTEXT_HEADER,
    parts: [{ type: "text", text: input.prompt }],
  };
}

export function opencodeSessionOptionsOf(input: ExternalTurnRequest): Record<string, unknown> {
  return {
    directory: input.cwd,
    title: "AgentUp turn",
    // 信任模式：普通工具一律放行；question 仍由一等 question.* 事件接入 Broker。
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  };
}

export function opencodeServerConfigOf(input: ExternalTurnRequest): Record<string, unknown> {
  const mcp: Record<string, unknown> = {};
  if (input.mcpServer) mcp.agentup = toOpencodeRemoteMcp(input.mcpServer);
  return {
    permission: "allow",
    mcp,
  };
}

/** OpenCode remote MCP 使用 headers（不是 Codex 的 http_headers）。 */
export function toOpencodeRemoteMcp(
  server: Record<string, unknown>,
): Record<string, unknown> {
  const headers =
    server.headers && typeof server.headers === "object" && !Array.isArray(server.headers)
      ? (server.headers as Record<string, string>)
      : {};
  return {
    type: "remote",
    url: typeof server.url === "string" ? server.url : "",
    headers,
    enabled: true,
    oauth: false,
  };
}
