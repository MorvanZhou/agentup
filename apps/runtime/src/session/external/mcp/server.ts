import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";

/**
 * 给外部 agent（本地 Agent App / SDK）用的 MCP server —— .cursor/skills/agentup-sdk-adapter/references/context-and-approvals.md §4.2。
 *
 * 为什么不走 SDK 自带的 `createSdkMcpServer` + `tool()`：那套要 Zod raw shape，
 * 会给 runtime 引入新依赖；而委托与技能工具的实现都在本进程里（DelegationService 在内存），
 * 起子进程再回调本机反而更绕。于是：
 *
 * - 进程内 hono 起一个**只监听 127.0.0.1** 的临时 HTTP MCP 端点；
 * - 每轮随机 token，`query({ options.mcpServers })` 里带上（外部 CLI 子进程连回来）；
 * - 回合结束就 `close()`，端口不留。
 */

/** MCP Streamable HTTP 的协议版本；客户端不认就在 initialize 结果里回它自己的版本。 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
/** 单次请求体上限：工具参数不该大，防止被喂爆。 */
const MAX_BODY_CHARS = 256 * 1024;

export type McpTool = {
  name: string;
  description: string;
  /** 手写 JSON Schema（object）。不引 zod：这里只有几个扁平参数。 */
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  handler: (args: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>;
};

export type ExternalMcpServer = {
  url: string;
  /** 直接塞进 `mcpServers.<name>.headers`。 */
  headers: Record<string, string>;
  close: () => Promise<void>;
};

export async function startExternalMcpServer(input: {
  tools: McpTool[];
  host?: string;
  token?: string;
  serverName?: string;
}): Promise<ExternalMcpServer> {
  const token = input.token ?? randomUUID();
  const host = input.host ?? "127.0.0.1";
  const app = new Hono();

  app.post("/mcp", (context) => handle(context.req.raw, { token, tools: input.tools, serverName: input.serverName }));
  app.post("/", (context) => handle(context.req.raw, { token, tools: input.tools, serverName: input.serverName }));
  app.get("/mcp", () => new Response("Method Not Allowed", { status: 405 }));

  const server = createAdaptorServer({ fetch: app.fetch }) as Server;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        headers: { Authorization: `Bearer ${token}` },
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

async function handle(
  request: Request,
  state: { token: string; tools: McpTool[]; serverName?: string },
): Promise<Response> {
  if (!authorized(request, state.token)) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "unauthorized" } }, 401);
  }
  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) {
      return json(rpcError(null, -32600, "请求体过大"));
    }
    payload = JSON.parse(raw);
  } catch {
    return json(rpcError(null, -32700, "不是合法 JSON"));
  }
  // 批量请求逐个回：MCP 客户端一般用单条，这里兜住数组形态
  if (Array.isArray(payload)) {
    const results = [];
    for (const item of payload) results.push(await dispatch(item, state));
    return json(results);
  }
  const result = await dispatch(payload, state);
  // 通知类（notifications/*）没有 result 也没有 error：按规范回 202 空体
  if (result === null) return new Response(null, { status: 202 });
  return json(result);
}

function authorized(request: Request, token: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${token}`;
}

async function dispatch(
  payload: unknown,
  state: { tools: McpTool[]; serverName?: string },
): Promise<Record<string, unknown> | null> {
  const row = (payload ?? {}) as { id?: unknown; method?: unknown; params?: unknown };
  const id = row.id ?? null;
  const method = typeof row.method === "string" ? row.method : "";
  if (!method) return rpcError(id, -32600, "缺少 method");
  if (method.startsWith("notifications/")) return null;

  if (method === "initialize") {
    const requested = requestedVersion(row.params);
    return rpcResult(id, {
      protocolVersion: requested ?? MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: state.serverName ?? "agentup", version: "1.0.0" },
    });
  }
  if (method === "tools/list") {
    return rpcResult(id, {
      tools: state.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
  }
  if (method === "tools/call") {
    const params = (row.params ?? {}) as { name?: unknown; arguments?: unknown };
    const name = typeof params.name === "string" ? params.name : "";
    const tool = state.tools.find((item) => item.name === name);
    if (!tool) return rpcError(id, -32602, `没有这个工具：${name}`);
    const args =
      params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};
    try {
      const outcome = await tool.handler(args);
      return rpcResult(id, {
        content: [{ type: "text", text: outcome.text }],
        ...(outcome.isError ? { isError: true } : {}),
      });
    } catch (error) {
      // 工具内部异常只把原因带回去，避免外部 agent 看到一堆栈
      const message = error instanceof Error ? error.message : "工具执行失败";
      return rpcResult(id, { content: [{ type: "text", text: `Error: ${message}` }], isError: true });
    }
  }
  if (method === "ping") return rpcResult(id, {});
  return rpcError(id, -32601, `不支持的方法：${method}`);
}

function requestedVersion(params: unknown): string | null {
  const row = (params ?? {}) as { protocolVersion?: unknown };
  return typeof row.protocolVersion === "string" ? row.protocolVersion : null;
}

function rpcResult(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
