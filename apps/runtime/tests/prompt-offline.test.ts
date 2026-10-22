import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { packageDigest } from "../src/package/digest.js";
import { startLocalServer } from "../src/local/server.js";

it("prompt uses disk visit when control plane is unreachable", async () => {
  const backend = await listen((_req, res) => {
    res.statusCode = 503;
    res.end("down");
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-prompt-offline-"));
  const agentId = "Weaty01";
  const userId = "guest";
  const visitRoot = path.join(root, "users", userId, "agents", agentId);
  const pi = path.join(visitRoot, "cwd", ".pi");
  fs.mkdirSync(pi, { recursive: true });
  fs.mkdirSync(path.join(visitRoot, "sessions"), { recursive: true });
  const files = {
    "SYSTEM.md": Buffer.from("你是Weaty。\n"),
  };
  const manifest = { version: 1, tools: [] as string[], modelCapabilities: [] as string[] };
  const digest = packageDigest(manifest, files);
  fs.writeFileSync(path.join(pi, "SYSTEM.md"), files["SYSTEM.md"]);
  fs.writeFileSync(
    path.join(visitRoot, "instance.json"),
    JSON.stringify({
      user_id: userId,
      agent_id: agentId,
      package_version: 1,
      package_digest: digest,
      active_session_id: "main",
      tools: [],
      model_capabilities: [],
      project_trust: "granted",
    }),
  );

  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    // directory 与 prompt 共用 resolveVisit：控制面挂了也应成功
    const directory = await fetch(`${local.url}/agents/${agentId}/directory`, {
      method: "POST",
      headers: {
        authorization: "Bearer guest",
        "content-type": "application/json",
      },
      body: JSON.stringify({ user_id: userId }),
    });
    expect(directory.status).toBe(200);
    const body = (await directory.json()) as { path: string };
    expect(body.path).toBe(visitRoot);
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
