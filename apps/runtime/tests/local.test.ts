import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { packTarGz } from "../src/package/archive.js";
import { packageDigest } from "../src/package/digest.js";
import { startLocalServer } from "../src/local/server.js";

const manifest = { version: 1, tools: [] as string[], modelCapabilities: [] as string[] };
const files = { "SYSTEM.md": Buffer.from("你是呼吸科医生") };
const digest = packageDigest(manifest, files);
const archivePromise = packTarGz(files);

it("lets two accounts recruit one agent and sync separate visits", async () => {
  const recruited = new Set<string>();
  const backend = await listen((req, res) => {
    if (req.url === "/v1/register" && req.method === "POST") {
      return readBody(req).then((raw) => {
        const body = JSON.parse(raw) as { email: string };
        json(res, 200, { email: body.email, status: "pending_verification" });
      });
    }
    if (req.url === "/v1/login" && req.method === "POST") {
      return readBody(req).then((raw) => {
        const body = JSON.parse(raw) as { email: string };
        const local = body.email.split("@")[0] ?? body.email;
        json(res, 200, {
          user_id: local,
          email: body.email,
          nickname: local,
          token: local,
        });
      });
    }
    const token = req.headers.authorization?.slice("Bearer ".length);
    if (!token) return json(res, 401, { error: "未登录" });
    if (req.url === "/v1/agents" && req.method === "GET") {
      return json(res, 200, {
        agents: [
          {
            agent_id: "respiratory-doctor",
            name: "呼吸科医生",
            background: "演示问诊",
            latest_version: manifest.version,
            latest_digest: digest,
            recruited: recruited.has(token),
            has_avatar: false,
            avatar_url: null,
          },
        ],
      });
    }
    if (req.url === "/v1/agents/respiratory-doctor/recruit" && req.method === "POST") {
      recruited.add(token);
      return json(res, 200, {
        user_id: token,
        agent_id: "respiratory-doctor",
        name: "呼吸科医生",
        latest_version: manifest.version,
        latest_digest: digest,
      });
    }
    if (req.url === "/v1/agents/respiratory-doctor/recruit" && req.method === "DELETE") {
      recruited.delete(token ?? "");
      return json(res, 200, { status: "ok" });
    }
    if (req.url === "/v1/recruits") {
      return json(res, 200, {
        recruits: recruited.has(token)
          ? [
              {
                user_id: token,
                agent_id: "respiratory-doctor",
                name: "呼吸科医生",
                latest_version: manifest.version,
                latest_digest: digest,
              },
            ]
          : [],
      });
    }
    if (req.url === "/v1/agents/respiratory-doctor/package") {
      return archivePromise.then((archive) => {
        const body = Buffer.from(archive);
        res.writeHead(200, {
          "content-type": "application/gzip",
          "content-length": body.length,
          "x-agent-id": "respiratory-doctor",
          "x-package-version": String(manifest.version),
          "x-package-digest": digest,
          "x-package-name": encodeURIComponent("呼吸科医生"),
          "x-package-background": encodeURIComponent("演示问诊"),
        });
        res.end(body);
      });
    }
    return json(res, 404, { error: "没有这个接口" });
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-local-"));
  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const first = await createAccount(local.url, "patient-a@example.com", "secret");
    const second = await createAccount(local.url, "patient-b@example.com", "secret");
    expect((await get(local.url, "/agents", "")).status).toBe(401);
    expect((await get(local.url, "/agents", first.token as string)).body).toMatchObject({
      agents: [{ agent_id: "respiratory-doctor", recruited: false }],
    });
    await post(local.url, "/agents/respiratory-doctor/recruit", undefined, first.token as string);
    await post(local.url, "/agents/respiratory-doctor/recruit", undefined, second.token as string);
    const synced = await post(
      local.url,
      "/agents/respiratory-doctor/sync",
      { user_id: first.user_id },
      first.token as string,
    );
    await post(local.url, "/agents/respiratory-doctor/sync", { user_id: second.user_id }, second.token as string);
    expect(synced).toMatchObject({ package_version: 1, package_digest: digest });
    const prompt = (userId: string) =>
      fs.readFileSync(
        path.join(root, "users", userId, "agents", "respiratory-doctor", "cwd", ".pi", "SYSTEM.md"),
        "utf8",
      );
    const directory = await post(
      local.url,
      "/agents/respiratory-doctor/directory",
      { user_id: first.user_id },
      first.token as string,
    );
    expect(directory.path).toBe(path.join(root, "users", "patient-a", "agents", "respiratory-doctor"));
    expect(fs.existsSync(directory.path as string)).toBe(true);
    expect(prompt("patient-a")).toBe("你是呼吸科医生");
    expect(prompt("patient-b")).toBe("你是呼吸科医生");
    const dismissed = await post(
      local.url,
      "/agents/respiratory-doctor/dismiss",
      { user_id: first.user_id },
      first.token as string,
    );
    expect(dismissed).toMatchObject({ status: "ok" });
    expect(fs.existsSync(directory.path as string)).toBe(false);
    expect(recruited.has("patient-a")).toBe(false);
    expect(fs.existsSync(path.join(os.homedir(), ".agentup", "users", "patient-a"))).toBe(false);
    expect((await post(local.url, "/messages", { text: "你好" }, first.token as string)).status).toBe(404);
  } finally {
    await local.close();
    await close(backend);
  }
});

it("allows CORS preflight from file:// packaged renderer (Origin null)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-cors-"));
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const response = await fetch(`${local.url}/health`, {
      method: "OPTIONS",
      headers: { origin: "null", "access-control-request-method": "GET" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("null");
    const health = await fetch(`${local.url}/health`, { headers: { origin: "null" } });
    expect(health.status).toBe(200);
    expect(health.headers.get("access-control-allow-origin")).toBe("null");
  } finally {
    await local.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** 注册仅返回 pending；测业务时用 login 拿 session（不依赖真实邮件验证）。 */
async function createAccount(base: string, email: string, password: string) {
  const pending = await post(base, "/register", { email, password });
  expect(pending).toMatchObject({ email, status: "pending_verification" });
  return post(base, "/login", { email, password });
}

async function post(base: string, pathName: string, body?: Record<string, unknown>, token?: string) {
  const response = await fetch(`${base}${pathName}`, {
    method: "POST",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, ...(await response.json() as Promise<Record<string, unknown>>) };
}

async function get(base: string, pathName: string, token: string) {
  const response = await fetch(`${base}${pathName}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function json(res: http.ServerResponse, status: number, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { "content-type": "application/json", "content-length": body.length });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  return new Promise<{ server: http.Server; address: AddressInfo }>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, address: server.address() as AddressInfo }));
  });
}

function close(running: { server: http.Server }) {
  return new Promise<void>((resolve, reject) => {
    running.server.close((error) => (error ? reject(error) : resolve()));
  });
}
