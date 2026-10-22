import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { startLocalServer } from "../src/local/server.js";

it("GET /agents falls back to disk-synced recruits when backend is down", async () => {
  const backend = await listen((_req, res) => {
    res.statusCode = 503;
    res.end("down");
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-agents-offline-"));
  const agentRoot = path.join(root, "users", "guest", "agents", "Weaty01");
  fs.mkdirSync(path.join(agentRoot, "cwd", ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(agentRoot, "instance.json"),
    JSON.stringify({
      agent_id: "Weaty01",
      package_version: 3,
      package_digest: "digest-w",
    }),
  );
  fs.writeFileSync(
    path.join(agentRoot, "cwd", ".pi", "SYSTEM.md"),
    "你是Weaty。岗位：气象员。\n\n获取气象信息\n",
  );
  const assets = path.join(agentRoot, "assets");
  fs.mkdirSync(assets, { recursive: true });
  const webp = Buffer.alloc(12);
  webp.write("RIFF", 0);
  webp.writeUInt32LE(4, 4);
  webp.write("WEBP", 8);
  fs.writeFileSync(path.join(assets, "avatar.webp"), webp);

  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const response = await fetch(`${local.url}/agents?user_id=guest`, {
      headers: { authorization: "Bearer guest" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { agents: Array<Record<string, unknown>> };
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).toMatchObject({
      agent_id: "Weaty01",
      name: "Weaty",
      role: "气象员",
      recruited: true,
      local_version: 3,
      has_avatar: true,
    });
    expect(String(body.agents[0]?.avatar_url)).toMatch(/^data:image\/webp;base64,/);
  } finally {
    await local.close();
    backend.server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  return new Promise<{ server: http.Server; address: AddressInfo }>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, address: server.address() as AddressInfo }));
  });
}
