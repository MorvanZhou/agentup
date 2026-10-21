import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { createRuntime } from "../src/app.js";
import { BackendClientError, listAgents, login, recruitAgent } from "../src/control/client.js";
import type { RuntimeConfig } from "../src/config/load.js";
import { packTarGz } from "../src/package/archive.js";
import { packageDigest } from "../src/package/digest.js";
import { NotRecruited } from "../src/package/sync.js";

const manifest = { version: 1, tools: [] as string[], modelCapabilities: [] as string[] };
const files = { "SYSTEM.md": Buffer.from("你是税务顾问") };
const digest = packageDigest(manifest, files);
const archivePromise = packTarGz(files);

it("syncs a recruited package from the control plane", async () => {
  let recruited = false;
  const server = await listen((req, res) => {
    if (req.url === "/v1/login" && req.method === "POST") {
      return json(res, 200, {
        user_id: "patient",
        email: "patient-a@example.com",
        nickname: "patient-a",
        token: "token",
      });
    }
    if (req.headers.authorization !== "Bearer token") {
      return json(res, 401, { error: "未登录" });
    }
    if (req.url === "/v1/agents" && req.method === "GET") {
      return json(res, 200, {
        agents: [
          {
            agent_id: "tax-advisor",
            name: "税务顾问",
            background: "公开",
            latest_version: manifest.version,
            latest_digest: digest,
            recruited,
            has_avatar: false,
            avatar_url: null,
          },
        ],
      });
    }
    if (req.url === "/v1/agents/tax-advisor/recruit" && req.method === "POST") {
      recruited = true;
      return json(res, 200, {
        user_id: "patient",
        agent_id: "tax-advisor",
        name: "税务顾问",
        latest_version: manifest.version,
        latest_digest: digest,
      });
    }
    if (req.url === "/v1/recruits") {
      return json(res, 200, {
        recruits: recruited ? [
          {
            user_id: "patient",
            agent_id: "tax-advisor",
            name: "税务顾问",
            latest_version: 1,
            latest_digest: digest,
          },
        ] : [],
      });
    }
    if (req.url === "/v1/agents/tax-advisor/package") {
      return archivePromise.then((archive) => {
        const body = Buffer.from(archive);
        res.writeHead(200, {
          "content-type": "application/gzip",
          "content-length": body.length,
          "x-agent-id": "tax-advisor",
          "x-package-version": String(manifest.version),
          "x-package-digest": digest,
          "x-package-name": encodeURIComponent("税务顾问"),
          "x-package-background": encodeURIComponent("公开"),
        });
        res.end(body);
      });
    }
    return json(res, 404, { error: "没有这个接口" });
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-control-"));
  try {
    const baseUrl = `http://127.0.0.1:${server.address.port}`;
    const session = await login(baseUrl, "patient-a@example.com", "secret");
    expect(await listAgents(baseUrl, session.token)).toEqual([
      {
        agentId: "tax-advisor",
        name: "税务顾问",
        role: "",
        background: "公开",
        latestVersion: 1,
        latestDigest: digest,
        recruited: false,
        hasAvatar: false,
        remark: "",
        recruitCount: 0,
        createdAt: "",
        updatedAt: "",
      },
    ]);
    expect(await recruitAgent(baseUrl, session.token, "tax-advisor")).toMatchObject({
      userId: "patient",
      agentId: "tax-advisor",
      latestVersion: 1,
      remark: "",
    });
    expect((await listAgents(baseUrl, session.token))[0].recruited).toBe(true);
    const runtime = createRuntime(config(baseUrl, root), session.token);
    const visit = await runtime.sync(session.userId, "tax-advisor");
    expect(fs.readFileSync(path.join(visit.root, "cwd", ".pi", "SYSTEM.md"), "utf8")).toBe("你是税务顾问");
    await expect(runtime.sync("other", "tax-advisor")).rejects.toBeInstanceOf(NotRecruited);
    expect(fs.existsSync(path.join(root, "users", "other"))).toBe(false);
    await expect(createRuntime(config(baseUrl, root), "nope").sync("patient", "tax-advisor")).rejects.toBeInstanceOf(
      BackendClientError,
    );
  } finally {
    await close(server);
  }
});

function config(backendUrl: string, userDataRoot: string): RuntimeConfig {
  return {
    backendUrl,
    userDataRoot,
    model: {
      providerId: "ollama",
      templateId: "ollama",
      modelId: "qwen",
      apiKey: "ollama",
      baseUrl: "http://localhost:11434/v1",
      kind: "ollama",
    },
  };
}

function json(res: http.ServerResponse, status: number, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { "content-type": "application/json", "content-length": body.length });
  res.end(body);
}

function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  return new Promise<{ server: http.Server; address: AddressInfo }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, address: server.address() as AddressInfo });
    });
  });
}

function close(running: { server: http.Server }) {
  return new Promise<void>((resolve, reject) => {
    running.server.close((error) => (error ? reject(error) : resolve()));
  });
}
