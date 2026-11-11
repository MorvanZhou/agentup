import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  artifactDeliveryTools,
  expectedArtifactMcpToolNames,
} from "../src/session/external/mcp/artifact-tools.js";
import { startExternalMcpServer, type McpTool } from "../src/session/external/mcp/server.js";
import type { DeliverArtifactsState } from "../src/session/tools/deliver-artifacts.js";

let root = "";
let open: Array<{ close: () => Promise<void> }> = [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-artifact-mcp-"));
  open = [];
});

afterEach(async () => {
  for (const server of open) await server.close().catch(() => undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

async function call(
  server: { url: string; headers: Record<string, string> },
  method: string,
  params?: unknown,
) {
  const response = await fetch(server.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...server.headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await response.json()) as { result?: Record<string, any>; error?: { code: number } };
}

async function callTool(
  server: { url: string; headers: Record<string, string> },
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError?: boolean }> {
  const response = await call(server, "tools/call", { name, arguments: args });
  return {
    text: (response.result?.content?.[0]?.text ?? "") as string,
    ...(response.result?.isError ? { isError: true } : {}),
  };
}

async function start(tools: McpTool[]) {
  const server = await startExternalMcpServer({ tools, token: "tok" });
  open.push(server);
  return server;
}

function state(): DeliverArtifactsState {
  return { confirmed: false, staged: [] };
}

it("群委托 MCP 只挂 complete_group_task；单聊委托只挂 deliver_artifacts", () => {
  expect(expectedArtifactMcpToolNames({ completeGroupTask: true })).toEqual(["complete_group_task"]);
  expect(expectedArtifactMcpToolNames({ deliverArtifacts: true })).toEqual(["deliver_artifacts"]);
  expect(expectedArtifactMcpToolNames({})).toEqual([]);
  expect(
    artifactDeliveryTools({
      kind: "complete_group_task",
      workspaceRoot: root,
      state: state(),
    }).map((tool) => tool.name),
  ).toEqual(["complete_group_task"]);
  expect(
    artifactDeliveryTools({
      kind: "deliver_artifacts",
      cwd: root,
      state: state(),
    }).map((tool) => tool.name),
  ).toEqual(["deliver_artifacts"]);
});

it("complete_group_task MCP 确认共享 ARTIFACT 路径并写入 deliverState", async () => {
  fs.mkdirSync(path.join(root, "ARTIFACT", "from-Cody-t1"), { recursive: true });
  fs.writeFileSync(path.join(root, "ARTIFACT", "from-Cody-t1", "page.html"), "<html></html>");
  const deliver = state();
  const server = await start(
    artifactDeliveryTools({
      kind: "complete_group_task",
      workspaceRoot: root,
      state: deliver,
    }),
  );

  const list = await call(server, "tools/list");
  expect(list.result?.tools?.map((tool: { name: string }) => tool.name)).toEqual([
    "complete_group_task",
  ]);
  const userSummaryDesc = list.result?.tools?.[0]?.inputSchema?.properties?.user_summary?.description ?? "";
  expect(userSummaryDesc).toMatch(/spoken|conversational|texting/i);
  expect(userSummaryDesc).toMatch(/Do NOT dump|PASS\/FAIL|SHA/i);

  const ok = await callTool(server, "complete_group_task", {
    paths: ["ARTIFACT/from-Cody-t1/page.html"],
    next_step: "Notify the user to open the HTML",
    user_summary: "HTML preview is ready in ARTIFACT",
  });
  expect(ok.isError).toBeUndefined();
  expect(ok.text).toContain("ARTIFACT/from-Cody-t1/page.html");
  expect(ok.text).toContain("User summary: HTML preview is ready in ARTIFACT");
  expect(ok.text).toContain("Next step: Notify the user to open the HTML");
  expect(deliver.confirmed).toBe(true);
  expect(deliver.nextStep).toBe("Notify the user to open the HTML");
  expect(deliver.userSummary).toBe("HTML preview is ready in ARTIFACT");
  expect(deliver.staged).toEqual([
    { path: "ARTIFACT/from-Cody-t1/page.html", size: "<html></html>".length },
  ]);
});

it("complete_group_task MCP 拒绝对路径 / 缺文件，且不误标 confirmed", async () => {
  const deliver = state();
  const server = await start(
    artifactDeliveryTools({
      kind: "complete_group_task",
      workspaceRoot: root,
      state: deliver,
    }),
  );
  const missing = await callTool(server, "complete_group_task", {
    paths: ["ARTIFACT/nope.html"],
    next_step: "",
    user_summary: "",
  });
  expect(missing.isError).toBe(true);
  expect(missing.text).toMatch(/missing|Error/i);
  expect(deliver.confirmed).toBe(false);
  expect(deliver.staged).toEqual([]);
});

it("deliver_artifacts MCP 确认私有 cwd ARTIFACT 并允许 paths: []", async () => {
  fs.mkdirSync(path.join(root, "ARTIFACT"), { recursive: true });
  fs.writeFileSync(path.join(root, "ARTIFACT", "note.md"), "hi");
  const deliver = state();
  const server = await start(
    artifactDeliveryTools({
      kind: "deliver_artifacts",
      cwd: root,
      state: deliver,
    }),
  );

  const empty = await callTool(server, "deliver_artifacts", { paths: [] });
  expect(empty.isError).toBeUndefined();
  expect(deliver.confirmed).toBe(true);
  expect(deliver.staged).toEqual([]);

  deliver.confirmed = false;
  const ok = await callTool(server, "deliver_artifacts", { paths: ["ARTIFACT/note.md"] });
  expect(ok.isError).toBeUndefined();
  expect(deliver.confirmed).toBe(true);
  expect(deliver.staged).toEqual([{ path: "ARTIFACT/note.md", size: 2 }]);
});
