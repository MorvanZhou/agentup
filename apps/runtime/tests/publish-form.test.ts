import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { packTarGz, unpackTarGz } from "../src/package/archive.js";
import { packageDigest } from "../src/package/digest.js";
import { startLocalServer } from "../src/local/server.js";

const weatherDir = path.resolve(import.meta.dirname, "../../agent_examples/weather/agent");
const avatarPng = fs.readFileSync(path.join(weatherDir, "assets", "avatar.png"));
const avatarDataUrl = `data:image/png;base64,${avatarPng.toString("base64")}`;

it("publishes from form without creating loc-* under user agents", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-publish-form-"));
  const backend = await listen(async (req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url === "/v1/agents/owned") {
      return json(res, 200, { agents: [] });
    }
    if (req.method === "POST" && url === "/v1/agents") {
      const { fields, files } = await readMultipart(req);
      const archive = files.archive;
      if (!archive) return json(res, 400, { error: "缺少 archive" });
      const unpacked = await unpackTarGz(archive);
      expect(unpacked["SYSTEM.md"]).toBeTruthy();
      expect(fields.name).toBe("表单天气");
      const manifest = { version: 1, tools: [], modelCapabilities: [] };
      return json(res, 202, {
        job_id: "job-1",
        status: "ready",
        agent_id: "formWx01",
        name: fields.name,
        role: fields.role,
        background: fields.background,
        manifest: { version: 1, tools: [], model_capabilities: [] },
        digest: packageDigest(manifest, unpacked),
        byte_size: archive.byteLength,
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
  const files = readAgentUp(weatherDir);
  const archive = await packTarGz(files);
  const digest = packageDigest({ version: 2, tools: [], modelCapabilities: [] }, files);
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
      res.writeHead(200, {
        "content-type": "application/gzip",
        "content-length": archive.byteLength,
        "x-package-version": "2",
        "x-package-digest": digest,
        "x-package-name": encodeURIComponent("Weaty"),
        "x-package-background": encodeURIComponent("查天气"),
        "x-agent-id": "hJsAC7Ph",
      });
      res.end(Buffer.from(archive));
      return;
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
    expect(Array.isArray(body.skills)).toBe(true);
    expect((body.skills as string[]).length).toBeGreaterThan(0);
    expect(listLocAgents(path.join(userDataRoot, "users"))).toEqual([]);
  } finally {
    await local.close();
    await close(backend);
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

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

function readAgentUp(agentDir: string): Record<string, Uint8Array> {
  const root = path.join(agentDir, ".agentup");
  const files: Record<string, Uint8Array> = {};
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, full).split(path.sep).join("/");
      files[relative] = fs.readFileSync(full);
    }
  };
  walk(root);
  return files;
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
