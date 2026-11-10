import {
  PRESENT_PREVIEW_TOOL,
  registerPresentPreviewRecipe,
} from "../../tools/present-preview.js";
import type { McpTool } from "./server.js";

/**
 * 外部 SDK 父会话：登记人侧 Launch Recipe（写 `.agentup/workspace.json`）。
 * 与 Pi builtin `present_preview` 同语义；模型侧全名 `mcp__agentup__present_preview`。
 * 委托子会话不挂（见 open.ts / session-factory：子会话不传 externalMcp）。
 */

export function expectedPreviewMcpToolNames(): string[] {
  return [PRESENT_PREVIEW_TOOL];
}

export function presentPreviewTools(input: { workspaceRoot: string }): McpTool[] {
  return [presentPreviewTool(input.workspaceRoot)];
}

function presentPreviewTool(workspaceRoot: string): McpTool {
  return {
    name: PRESENT_PREVIEW_TOOL,
    description:
      "Register a launch recipe so the user can open an embedded preview of a local web server. " +
      "Writes `.agentup/workspace.json` under the thread workspace. " +
      "Start the local server with your own shell tools first when needed; " +
      "do not use this instead of Playwright MCP for verification. " +
      "Static ARTIFACT HTML/Markdown/images use the file preview UI — do not call this for those.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Stable recipe id (slug). Default: derived from title or preview_url host/port.",
        },
        title: {
          type: "string",
          description: "Short label shown on the preview card.",
        },
        command: {
          type: "string",
          description: "Shell command to (re)start the preview process, e.g. npm run dev.",
        },
        cwd: {
          type: "string",
          description: "Working directory relative to the thread workspace root. Default: .",
        },
        preview_url: {
          type: "string",
          description: "Local http(s) URL the user should open (localhost / 127.0.0.1 only).",
        },
        linked_job_id: {
          type: "string",
          description: "Optional background job id already serving this URL.",
        },
      },
      required: ["title", "command", "preview_url"],
    },
    async handler(args) {
      const result = registerPresentPreviewRecipe(workspaceRoot, args);
      return result.ok ? { text: result.text } : { text: result.text, isError: true };
    },
  };
}
