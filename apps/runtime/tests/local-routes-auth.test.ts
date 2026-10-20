import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { startLocalServer } from "../src/local/server.js";

it("proxies register, verify-email, oauth and turnstile through the loopback API", async () => {
  const backend = await listen((req, res) => {
    if (req.url === "/v1/register" && req.method === "POST") {
      return readBody(req).then((raw) => {
        const body = JSON.parse(raw) as { email: string };
        json(res, 200, { email: body.email, status: "pending_verification" });
      });
    }
    if (req.url === "/v1/auth/verify-email" && req.method === "POST") {
      return readBody(req).then((raw) => {
        const body = JSON.parse(raw) as { email: string; code: string };
        if (body.code !== "123456" || body.email !== "patient@example.com") {
          return json(res, 400, { error: "验证码无效或已过期" });
        }
        json(res, 200, {
          user_id: "patient",
          email: "patient@example.com",
          nickname: "patient",
          token: "tok-patient",
          has_avatar: false,
          avatar_url: null,
        });
      });
    }
    if (req.url === "/v1/auth/forgot-password" && req.method === "POST") {
      return json(res, 200, { ok: true });
    }
    if (req.url === "/v1/auth/reset-password" && req.method === "POST") {
      return json(res, 200, {
        user_id: "patient",
        email: "patient@example.com",
        nickname: "patient",
        token: "tok-reset",
        has_avatar: false,
        avatar_url: null,
      });
    }
    if (req.url?.startsWith("/v1/auth/oauth/github/start")) {
      return json(res, 200, { note: "start is a redirect in real backend" });
    }
    if (req.url === "/v1/auth/oauth/exchange" && req.method === "POST") {
      return json(res, 200, {
        user_id: "oauth",
        email: "oauth@example.com",
        nickname: "oauth",
        token: "tok-oauth",
        has_avatar: false,
        avatar_url: null,
      });
    }
    if (req.url === "/v1/auth/turnstile" && req.method === "GET") {
      return json(res, 200, { site_key: "", required: false });
    }
    return json(res, 404, { error: "没有这个接口" });
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-auth-extra-"));
  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const pending = await request(local.url, "POST", "/register", {
      email: "patient@example.com",
      password: "secret12",
      turnstile_token: "",
    });
    expect(pending.status).toBe(200);
    expect(pending.body).toEqual({ email: "patient@example.com", status: "pending_verification" });

    const verified = await request(local.url, "POST", "/auth/verify-email", {
      email: "patient@example.com",
      code: "123456",
    });
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ user_id: "patient", token: "tok-patient" });

    expect((await request(local.url, "POST", "/auth/forgot-password", { email: "patient@example.com" })).status).toBe(
      200,
    );
    const reset = await request(local.url, "POST", "/auth/reset-password", {
      email: "patient@example.com",
      code: "654321",
      password: "secret99",
    });
    expect(reset.body).toMatchObject({ token: "tok-reset" });

    const authorize = await request(local.url, "POST", "/auth/oauth/github/authorize-url", {
      loopback_uri: "http://127.0.0.1:9/cb",
    });
    expect(authorize.status).toBe(200);
    expect(String(authorize.body.url)).toContain("/v1/auth/oauth/github/start");
    expect(String(authorize.body.url)).toContain("loopback_uri=");

    const exchanged = await request(local.url, "POST", "/auth/oauth/exchange", { code: "x" });
    expect(exchanged.body).toMatchObject({ user_id: "oauth", token: "tok-oauth" });

    const turnstile = await request(local.url, "GET", "/auth/turnstile");
    expect(turnstile.body).toEqual({ site_key: "", required: false });
  } finally {
    await local.close();
    await close(backend);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("proxies login, owned agents, and remark through the loopback API", async () => {
  let remark = "";
  const backend = await listen((req, res) => {
    if (req.url === "/v1/login" && req.method === "POST") {
      return readBody(req).then((raw) => {
        const body = JSON.parse(raw) as { email: string; password: string };
        if (body.password !== "secret") return json(res, 401, { error: "邮箱或密码错误" });
        const local = body.email.split("@")[0] ?? body.email;
        json(res, 200, { user_id: local, email: body.email, nickname: local, token: `tok-${local}` });
      });
    }
    const token = req.headers.authorization?.slice("Bearer ".length);
    if (!token) return json(res, 401, { error: "未登录" });
    if (req.url?.startsWith("/v1/agents/owned") && req.method === "GET") {
      const url = new URL(req.url, "http://127.0.0.1");
      const q = url.searchParams.get("q") ?? "";
      const agents = [
        {
          agent_id: "weather",
          name: "Weaty",
          role: "气象员",
          summary: "查天气",
          latest_version: 1,
          latest_digest: "d1",
          recruited: true,
          has_avatar: false,
          avatar_url: null,
          remark,
          recruit_count: 2,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ].filter((agent) => !q || agent.name.includes(q) || agent.role.includes(q) || agent.agent_id.includes(q));
      return json(res, 200, { agents });
    }
    if (req.url === "/v1/agents/weather/remark" && req.method === "PUT") {
      return readBody(req).then((raw) => {
        const body = JSON.parse(raw) as { remark: string };
        remark = body.remark;
        json(res, 200, {
          user_id: "patient",
          agent_id: "weather",
          name: "Weaty",
          role: "气象员",
          latest_version: 1,
          latest_digest: "d1",
          remark,
        });
      });
    }
    return json(res, 404, { error: "没有这个接口" });
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-auth-routes-"));
  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const bad = await request(local.url, "POST", "/login", { email: "patient@example.com", password: "wrong" });
    expect(bad.status).toBe(401);

    const session = await request(local.url, "POST", "/login", {
      email: "patient@example.com",
      password: "secret",
    });
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({
      user_id: "patient",
      email: "patient@example.com",
      nickname: "patient",
      token: "tok-patient",
    });

    const token = session.body.token as string;
    expect((await request(local.url, "GET", "/agents/owned")).status).toBe(401);
    const owned = await request(local.url, "GET", "/agents/owned", undefined, token);
    expect(owned.status).toBe(200);
    expect(owned.body).toMatchObject({
      agents: [{ agent_id: "weather", name: "Weaty", role: "气象员", remark: "", recruit_count: 2 }],
    });

    const filtered = await request(local.url, "GET", `/agents/owned?q=${encodeURIComponent("气象")}`, undefined, token);
    expect(filtered.body).toMatchObject({ agents: [{ agent_id: "weather" }] });
    const empty = await request(local.url, "GET", "/agents/owned?q=missing", undefined, token);
    expect(empty.body).toEqual({ agents: [] });

    const saved = await request(local.url, "PUT", "/agents/weather/remark", { remark: "办公天气" }, token);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ agent_id: "weather", remark: "办公天气" });
    const again = await request(local.url, "GET", "/agents/owned", undefined, token);
    expect(again.body).toMatchObject({ agents: [{ remark: "办公天气" }] });

    expect((await request(local.url, "PUT", "/agents/../evil/remark", { remark: "x" }, token)).status).toBe(404);
  } finally {
    await local.close();
    await close(backend);
  }
});

async function request(
  base: string,
  method: string,
  pathname: string,
  body?: Record<string, unknown>,
  token?: string,
) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
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
