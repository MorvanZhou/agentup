import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { startLocalServer } from "../src/local/server.js";

it("proxies the public agent catalog without a bearer token", async () => {
  const backend = await listen((req, res) => {
    if (req.url?.startsWith("/v1/agents/public") && req.method === "GET") {
      if (req.headers.authorization) return json(res, 400, { error: "不应带 token" });
      const url = new URL(req.url, "http://127.0.0.1");
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const agents = [
        {
          agent_id: "weather",
          name: "天气播报员",
          background: "查天气",
          latest_version: 1,
          latest_digest: "d1",
          recruited: false,
          has_avatar: false,
          avatar_url: null,
          remark: "",
          recruit_count: 3,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ].filter((agent) => !q || agent.name.toLowerCase().includes(q));
      return json(res, 200, { agents });
    }
    json(res, 404, { error: "not found" });
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-public-agents-"));
  const local = await startLocalServer({
    backendUrl: backend.url,
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const listed = await fetch(`${local.url}/agents/public`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      agents: [
        {
          agent_id: "weather",
          name: "天气播报员",
          recruited: false,
          local_version: 0,
          recruit_count: 3,
        },
      ],
    });

    const filtered = await fetch(`${local.url}/agents/public?q=${encodeURIComponent("天气")}`);
    expect(filtered.status).toBe(200);
    expect((await filtered.json()).agents).toHaveLength(1);

    const empty = await fetch(`${local.url}/agents/public?q=missing`);
    expect(empty.status).toBe(200);
    expect((await empty.json()).agents).toEqual([]);
  } finally {
    await local.close();
    await backend.close();
  }
});

function listen(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
    server.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
