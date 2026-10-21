import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { unpackTarGz } from "../src/package/archive.js";
import { packageDigest } from "../src/package/digest.js";
import { startLocalServer } from "../src/local/server.js";

const weatherDir = path.resolve(import.meta.dirname, "../../agent_examples/weather/agent");

it("publishes a selected agent directory and a later version", async () => {
  const seenVersions: number[] = [];
  const backend = await listen(async (req, res) => {
    if (req.method !== "POST" || !["/v1/agents", "/v1/agents/generated-id/publish"].includes(req.url ?? "")) {
      return json(res, 404, { error: "没有这个接口" });
    }
    const { fields, files } = await readMultipart(req);
    const archive = files.archive;
    if (!archive) return json(res, 400, { error: "缺少 archive" });
    const version = seenVersions.length + 1;
    seenVersions.push(version);
    const unpacked = await unpackTarGz(archive);
    const manifest = { version, tools: [], modelCapabilities: [] };
    // 异步发布：可直接返回 ready，runtime 会跳过轮询。
    return json(res, 202, {
      job_id: `job-${version}`,
      status: "ready",
      agent_id: "generated-id",
      name: fields.name,
      role: fields.role,
      background: fields.background,
      manifest: { version, tools: [], model_capabilities: [] },
      digest: packageDigest(manifest, unpacked),
      byte_size: archive.byteLength,
    });
  });
  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot: fs.mkdtempSync(path.join(os.tmpdir(), "agentup-publish-")),
    host: "127.0.0.1",
    port: 0,
  });
  const nextDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-weather-v2-"));
  fs.cpSync(weatherDir, nextDir, { recursive: true });
  fs.appendFileSync(path.join(nextDir, ".agentup", "AGENTS.md"), "\n第二版\n");
  try {
    expect(await inspect(local.url, weatherDir, "owner")).toMatchObject({
      status: 200,
      file_count: 3,
      avatar_preview: expect.stringMatching(/^data:image\/png;base64,/),
    });
    expect(await publish(local.url, weatherDir, "owner", undefined)).toMatchObject({
      status: 200,
      agent_id: "generated-id",
      version: 1,
    });
    expect(await publish(local.url, nextDir, "owner", "generated-id")).toMatchObject({ status: 200, version: 2 });
    expect(seenVersions).toEqual([1, 2]);
    expect(await publish(local.url, path.join(nextDir, "missing"), "owner", undefined)).toMatchObject({
      status: 400,
      error: "Agent 目录不存在",
    });
  } finally {
    await local.close();
    await close(backend);
  }
});

it("updates card without republishing the package", async () => {
  let cardName = "Weaty";
  let cardBackground = "演示天气";
  let cardRules = "";
  const backend = await listen(async (req, res) => {
    const url = req.url ?? "";
    if (req.method === "PUT" && url === "/v1/agents/generated-id/card") {
      const { fields } = await readMultipart(req);
      cardName = fields.name ?? cardName;
      cardBackground = fields.background ?? cardBackground;
      cardRules = fields.rules ?? "";
      return json(res, 200, {
        agent_id: "generated-id",
        name: cardName,
        role: fields.role ?? "",
        background: cardBackground,
        rules: cardRules,
        latest_version: 1,
        latest_digest: "digest-v1",
        recruited: false,
        has_avatar: false,
        avatar_url: null,
        remark: "",
        recruit_count: 0,
        created_at: "2026-02-01T00:00:00Z",
        updated_at: "2026-02-01T00:00:00Z",
      });
    }
    return json(res, 404, { error: "没有这个接口" });
  });
  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot: fs.mkdtempSync(path.join(os.tmpdir(), "agentup-card-update-")),
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const response = await fetch(`${local.url}/agents/generated-id/card`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: "Bearer owner" },
      body: JSON.stringify({
        name: "Weaty 改名",
        role: "气象员",
        background: "只改名片",
        rules: "保持简洁",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      agent_id: "generated-id",
      name: "Weaty 改名",
      background: "只改名片",
      latest_version: 1,
      latest_digest: "digest-v1",
    });
    expect(cardName).toBe("Weaty 改名");
    expect(cardRules).toBe("保持简洁");
  } finally {
    await local.close();
    await close(backend);
  }
});

it("passes publish ownership errors through the local API", async () => {
  const backend = await listen((_req, res) => json(res, 403, { error: "不是这个 Agent 的发布者" }));
  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot: fs.mkdtempSync(path.join(os.tmpdir(), "agentup-publish-")),
    host: "127.0.0.1",
    port: 0,
  });
  try {
    expect(await publish(local.url, weatherDir, "other", "generated-id")).toEqual({
      status: 403,
      error: "不是这个 Agent 的发布者",
    });
  } finally {
    await local.close();
    await close(backend);
  }
});

it("returns structured package validation details from inspect", async () => {
  const broken = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-broken-"));
  fs.mkdirSync(path.join(broken, ".agentup"), { recursive: true });
  fs.writeFileSync(path.join(broken, ".agentup", "APPEND_SYSTEM.md"), "旧系统提示\n");
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: fs.mkdtempSync(path.join(os.tmpdir(), "agentup-publish-")),
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const result = await inspect(local.url, broken, "owner");
    expect(result).toMatchObject({
      status: 400,
      error: "运行包校验失败",
    });
    expect(result.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "APPEND_SYSTEM.md" })]),
    );
    expect(result.details).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "SYSTEM.md", message: expect.stringContaining("缺少") }),
      ]),
    );
  } finally {
    await local.close();
  }
});

async function inspect(base: string, agentDir: string, token: string) {
  const response = await fetch(`${base}/agents/inspect`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ agent_dir: agentDir }),
  });
  return { status: response.status, ...((await response.json()) as Record<string, unknown>) };
}

async function publish(base: string, agentDir: string, token: string, agentId: string | undefined) {
  const response = await fetch(`${base}/agents/publish`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      agent_dir: agentDir,
      name: "Weaty",
      role: "气象员",
      background: "演示天气",
      ...(agentId ? { agent_id: agentId } : {}),
    }),
  });
  return { status: response.status, ...((await response.json()) as Record<string, unknown>) };
}

function json(res: http.ServerResponse, status: number, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { "content-type": "application/json", "content-length": body.length });
  res.end(body);
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
    let content = part.subarray(headerEnd + 4);
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
