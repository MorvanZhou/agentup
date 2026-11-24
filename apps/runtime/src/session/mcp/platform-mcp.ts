import { BROWSER_MCP_NAME, browserStdioConfig } from "./browser-platform.js";
import { COMPUTER_MCP_NAME, computerStdioConfig } from "./computer-platform.js";
import { PLAYWRIGHT_MCP_NAME, playwrightStdioConfig } from "./playwright-platform.js";

/**
 * Host 平台注入的 MCP server 名清单（不含用户 mcp.json）。
 * 审批按大功能收拢：playwright+browser → Browser Use；computer → Computer Use。
 * 见 approval/tools `capabilityAllowKey`。
 */
export const PLATFORM_MCP_NAMES = [
  PLAYWRIGHT_MCP_NAME,
  BROWSER_MCP_NAME,
  COMPUTER_MCP_NAME,
] as const;

/**
 * Host → ExternalTurnRequest.platformMcpServers 的唯一组装口。
 * 新增平台 MCP 只改这里；turn-factory / stream-bridge 禁止再手写散落对象字面量。
 */
export function platformMcpServersOf(
  userDataRoot: string,
): Record<string, Record<string, unknown>> {
  return {
    [PLAYWRIGHT_MCP_NAME]: playwrightStdioConfig(userDataRoot),
    [BROWSER_MCP_NAME]: browserStdioConfig(userDataRoot),
    [COMPUTER_MCP_NAME]: computerStdioConfig(userDataRoot),
  };
}
