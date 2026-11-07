import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { unpackTarGz } from "../src/package/archive.js";
import { packageDigest } from "../src/package/digest.js";
import { validateAgentPackage } from "../src/package/validate.js";
import { startLocalServer } from "../src/local/server.js";

const standardMcp = {
  mcpServers: {
    "server-name": {
      type: "stdio",
      command: "executable-path",
      args: ["arg1", "arg2"],
      env: { KEY: "value" },
    },
  },
};

const weatherDir = path.resolve(import.meta.dirname, "../../agent_examples/single/weather/agent");
const avatarPng = fs.readFileSync(path.join(weatherDir, "assets", "avatar.png"));
const avatarDataUrl = `data:image/png;base64,${avatarPng.toString("base64")}`;

it("publishes from form without creating loc-* under user agents", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-publish-form-"));
  let endpoint = "127.0.0.1:9";
  let stored: Uint8Array | undefined;
  const backend = await listen(async (req, res) => {
    const url = req.url ?? "";
    if (req.method === "PUT") {
      stored = new Uint8Array(await readRaw(req));
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === "GET" && url === "/v1/agents/owned") {
      return json(res, 200, { agents: [] });
    }
    if (req.method === "POST" && url === "/v1/agents/publish-jobs/job-1/uploaded") {
      if (!stored) return json(res, 400, { error: "还没上传" });
      const unpacked = await unpackTarGz(stored);
      expect(unpacked["SYSTEM.md"]).toBeTruthy();
      const manifest = { version: 1, tools: [], modelCapabilities: [] };
      return json(res, 200, {
        job_id: "job-1",
        status: "ready",
        agent_id: "formWx01",
        name: "表单天气",
        role: "气象员",
        background: "查天气",
        manifest: { version: 1, tools: [], model_capabilities: [] },
        digest: packageDigest(manifest, unpacked),
        byte_size: stored.byteLength,
      });
    }
    if (req.method === "POST" && url === "/v1/agents") {
      const { fields } = await readMultipart(req);
      expect(fields.name).toBe("表单天气");
      return json(res, 202, {
        job_id: "job-1",
        status: "awaiting_upload",
        upload: {
          bucket: endpoint,
          region: "local",
          key: "dev/packages/formWx01/v1.tar.gz",
          tmp_secret_id: "id",
          tmp_secret_key: "key",
          session_token: "token",
          content_type: "application/gzip",
          expired_at: 1,
        },
      });
    }
    return json(res, 404, { error: "没有这个接口" });
  });
  endpoint = `127.0.0.1:${backend.address.port}`;
  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const response = await fetch(`${local.url}/agents/publish-editor`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner" },
      body: JSON.stringify({
        name: "表单天气",
        role: "气象员",
        background: "查天气",
        rules: "简洁回答",
        avatar_data_url: avatarDataUrl,
        mcp_servers: { weather: { url: "http://127.0.0.1:9/mcp" } },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      agent_id: "formWx01",
      name: "表单天气",
      version: 1,
    });
    expect(listLocAgents(path.join(userDataRoot, "users"))).toEqual([]);
  } finally {
    await local.close();
    await close(backend);
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

it("previews owned package without writing loc-*", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-publish-preview-"));
  const digest = "ab".repeat(32);
  const backend = await listen(async (req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url === "/v1/agents/owned") {
      return json(res, 200, {
        agents: [
          {
            agent_id: "hJsAC7Ph",
            name: "Weaty",
            role: "气象员",
            background: "查天气",
            rules: "名片规则",
            skills: [{ name: "check-weather", md5: "ab".repeat(16) }],
            mcp_md5: "",
            latest_version: 2,
            latest_digest: digest,
            recruited: false,
            has_avatar: true,
            avatar_url: "http://127.0.0.1/avatar.webp",
            remark: "",
            recruit_count: 0,
            created_at: "2026-02-01T00:00:00Z",
            updated_at: "2026-02-01T00:00:00Z",
          },
        ],
      });
    }
    if (req.method === "GET" && url === "/v1/agents/hJsAC7Ph/package") {
      return json(res, 500, { error: "预览不应下载运行包" });
    }
    return json(res, 404, { error: "没有这个接口" });
  });
  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const response = await fetch(`${local.url}/agents/publish-editor/preview`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner" },
      body: JSON.stringify({ published_agent_id: "hJsAC7Ph" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      agent_id: "hJsAC7Ph",
      name: "Weaty",
      role: "气象员",
      rules: "名片规则",
      avatar_url: "http://127.0.0.1/avatar.webp",
    });
    expect(body.skills).toEqual(["check-weather"]);
    expect(body.mcp_servers).toEqual({});
    expect(body.mcp_present).toBe(false);
    expect(listLocAgents(path.join(userDataRoot, "users"))).toEqual([]);
  } finally {
    await local.close();
    await close(backend);
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

it("stores a pasted mcp.json as one mcpServers layer", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-publish-mcp-doc-"));
  let uploaded = "";
  const backend = await listen(async (req, res) => {
    const url = req.url ?? "";
    if (req.method === "PUT") {
      uploaded = (await readRaw(req)).toString("utf8");
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === "GET" && url === "/v1/agents/owned") return json(res, 200, { agents: [ownedCard()] });
    if (req.method === "POST" && url === "/v1/agents/hJsAC7Ph/publish") {
      return json(res, 202, {
        job_id: "job-mcp",
        status: "awaiting_upload",
        uploads: [uploadGrant(backendPort(req), "dev/agents/hJsAC7Ph/mcp.json", "application/json")],
      });
    }
    if (req.method === "POST" && url === "/v1/agents/publish-jobs/job-mcp/uploaded") {
      return json(res, 200, readyJob());
    }
    return json(res, 404, { error: "没有这个接口" });
  });
  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const response = await fetch(`${local.url}/agents/publish-editor`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner" },
      body: JSON.stringify({
        agent_id: "hJsAC7Ph",
        name: "Weaty",
        role: "气象员",
        background: "查天气",
        rules: "名片规则",
        mcp_servers: standardMcp,
      }),
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(uploaded)).toEqual(standardMcp);
    expect(validateAgentPackage({ "SYSTEM.md": Buffer.from("ok\n"), "mcp.json": Buffer.from(uploaded) })).toEqual([]);
  } finally {
    await local.close();
    await close(backend);
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

it("rejects an mcp server value that is not an object before upload", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-publish-mcp-bad-"));
  let uploaded = false;
  const backend = await listen(async (req, res) => {
    const url = req.url ?? "";
    if (req.method === "PUT") {
      uploaded = true;
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === "GET" && url === "/v1/agents/owned") return json(res, 200, { agents: [ownedCard()] });
    if (req.method === "POST" && url === "/v1/agents/hJsAC7Ph/publish") {
      return json(res, 202, {
        job_id: "job-bad",
        status: "awaiting_upload",
        uploads: [uploadGrant(backendPort(req), "dev/agents/hJsAC7Ph/mcp.json", "application/json")],
      });
    }
    return json(res, 404, { error: "没有这个接口" });
  });
  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const response = await fetch(`${local.url}/agents/publish-editor`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner" },
      body: JSON.stringify({
        agent_id: "hJsAC7Ph",
        name: "Weaty",
        role: "气象员",
        background: "查天气",
        mcp_servers: { s: "d" },
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      details: [{ path: "mcp.json", message: "mcpServers.s 必须是对象" }],
    });
    expect(uploaded).toBe(false);
  } finally {
    await local.close();
    await close(backend);
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

function ownedCard() {
  return {
    agent_id: "hJsAC7Ph",
    name: "Weaty",
    role: "气象员",
    background: "查天气",
    rules: "名片规则",
    skills: [],
    mcp_md5: "",
    latest_version: 2,
    latest_digest: "ab".repeat(32),
    recruited: false,
    has_avatar: false,
    remark: "",
    recruit_count: 0,
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
  };
}

function readyJob() {
  return {
    job_id: "job-mcp",
    status: "ready",
    agent_id: "hJsAC7Ph",
    name: "Weaty",
    role: "气象员",
    background: "查天气",
    manifest: { version: 3, tools: [], model_capabilities: [] },
    digest: "cd".repeat(32),
    byte_size: 1,
  };
}

function uploadGrant(port: number, key: string, contentType: string) {
  return {
    bucket: `127.0.0.1:${port}`,
    region: "local",
    key,
    tmp_secret_id: "id",
    tmp_secret_key: "key",
    session_token: "token",
    content_type: contentType,
    expired_at: 1,
  };
}

function backendPort(req: http.IncomingMessage): number {
  const host = req.headers.host ?? "";
  return Number(host.split(":")[1] ?? 0);
}

function listLocAgents(usersRoot: string): string[] {
  if (!fs.existsSync(usersRoot)) return [];
  const found: string[] = [];
  for (const user of fs.readdirSync(usersRoot)) {
    const agentsDir = path.join(usersRoot, user, "agents");
    if (!fs.existsSync(agentsDir)) continue;
    for (const name of fs.readdirSync(agentsDir)) {
      if (name.startsWith("loc-")) found.push(name);
    }
  }
  return found;
}

function json(res: http.ServerResponse, status: number, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { "content-type": "application/json", "content-length": body.length });
  res.end(body);
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

function readRaw(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readMultipart(req: http.IncomingMessage): Promise<{
  fields: Record<string, string>;
  files: Record<string, Uint8Array>;
}> {
  const contentType = req.headers["content-type"] ?? "";
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw new Error("missing multipart boundary");
  const boundary = Buffer.from(`--${match[1] ?? match[2]!}`);
  const body = await readBody(req);
  const fields: Record<string, string> = {};
  const files: Record<string, Uint8Array> = {};
  let start = indexOf(body, boundary, 0);
  while (start >= 0) {
    const next = indexOf(body, boundary, start + boundary.length);
    if (next < 0) break;
    let part = body.subarray(start + boundary.length, next);
    if (part[0] === 0x0d && part[1] === 0x0a) part = part.subarray(2);
    if (part.length >= 2 && part[part.length - 2] === 0x0d && part[part.length - 1] === 0x0a) {
      part = part.subarray(0, part.length - 2);
    }
    const headerEnd = indexOf(part, Buffer.from("\r\n\r\n"), 0);
    if (headerEnd < 0) {
      start = next;
      continue;
    }
    const header = part.subarray(0, headerEnd).toString("utf8");
    const content = part.subarray(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/.exec(header);
    if (!nameMatch) {
      start = next;
      continue;
    }
    const name = nameMatch[1]!;
    if (/filename="/.test(header)) {
      files[name] = new Uint8Array(content);
    } else {
      fields[name] = content.toString("utf8");
    }
    start = next;
  }
  return { fields, files };
}

function indexOf(haystack: Buffer, needle: Buffer, from: number): number {
  return haystack.indexOf(needle, from);
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
