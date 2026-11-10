import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  expectedPreviewMcpToolNames,
  presentPreviewTools,
} from "../src/session/external/mcp/preview-tools.js";
import { readWorkspaceConfig } from "../src/session/workspace/workspace-config.js";

it("expectedPreviewMcpToolNames lists present_preview only", () => {
  expect(expectedPreviewMcpToolNames()).toEqual(["present_preview"]);
});

it("present_preview MCP writes workspace.json recipe", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-preview-mcp-"));
  const [tool] = presentPreviewTools({ workspaceRoot: root });
  expect(tool.name).toBe("present_preview");
  const result = await tool.handler({
    title: "Dev",
    command: "npm run dev",
    preview_url: "http://127.0.0.1:5173",
    id: "web",
  });
  expect(result.isError).toBeUndefined();
  expect(result.text).toContain("Preview recipe registered (web)");
  expect(readWorkspaceConfig(root)?.preview?.recipes?.[0]).toMatchObject({
    id: "web",
    title: "Dev",
    preview_url: "http://127.0.0.1:5173",
  });
});

it("present_preview MCP rejects non-localhost url", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-preview-mcp-bad-"));
  const [tool] = presentPreviewTools({ workspaceRoot: root });
  const result = await tool.handler({
    title: "Remote",
    command: "x",
    preview_url: "https://example.com",
  });
  expect(result.isError).toBe(true);
  expect(result.text).toContain("localhost");
  expect(readWorkspaceConfig(root)?.preview?.recipes ?? []).toEqual([]);
});
