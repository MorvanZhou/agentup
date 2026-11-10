import type { ExternalTurnRequest } from "./contract.js";

/**
 * 把 Host 的 agentup HTTP MCP 与 platformMcpServers（Playwright 等）合成厂商 `mcpServers` 形。
 * 各 adapter 应整表合并，禁止只挂 agentup 或只写死 `playwright` 键。
 */
export function mergeExternalTurnMcpServers(
  input: Pick<ExternalTurnRequest, "mcpServer" | "platformMcpServers">,
  mapAgentup: (server: Record<string, unknown>) => unknown = (server) => server,
): Record<string, unknown> | undefined {
  if (!input.mcpServer && !input.platformMcpServers) return undefined;
  return {
    ...(input.mcpServer ? { agentup: mapAgentup(input.mcpServer) } : {}),
    ...(input.platformMcpServers ?? {}),
  };
}
