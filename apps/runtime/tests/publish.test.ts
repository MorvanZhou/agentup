import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { BackendClientError, publishAgent } from "../src/control/client.js";
import { unpackTarGz } from "../src/package/archive.js";
import { packageDigest } from "../src/package/digest.js";
import { AgentSourceError, loadAgentSource, preparePublishSource } from "../src/package/source.js";

const agentDir = path.resolve(import.meta.dirname, "../../agent_examples/single/respiratory-doctor/agent");
const weatherDir = path.resolve(import.meta.dirname, "../../agent_examples/single/weather/agent");
const exchangeRateDir = path.resolve(import.meta.dirname, "../../agent_examples/single/exchange-rate/agent");
const worldClockDir = path.resolve(import.meta.dirname, "../../agent_examples/single/world-clock/agent");
const cryptoPriceDir = path.resolve(import.meta.dirname, "../../agent_examples/single/crypto-price/agent");

it("loads the respiratory doctor package directly from agent", () => {
  const source = loadAgentSource(agentDir);
  expect(Object.keys(source.files).sort()).toEqual([
    "AGENTS.md",
    "mcp.json",
    "skills/respiratory-consult/SKILL.md",
  ]);
  expect(source.files["SYSTEM.md"]).toBeUndefined();
  expect(source.avatar).toBeInstanceOf(Uint8Array);
  expect(source.avatarMime).toBe("image/png");
  const rules = Buffer.from(source.files["AGENTS.md"]!).toString("utf8");
  expect(rules).toContain("线下就医");
  const mcp = JSON.parse(Buffer.from(source.files["mcp.json"]!).toString("utf8")) as {
    mcpServers: { respiratory: { url: string; headers?: unknown } };
  };
  expect(mcp.mcpServers.respiratory.url).toBe("http://127.0.0.1:8788/mcp");
  expect(mcp.mcpServers.respiratory.headers).toBeUndefined();
});

it("composes SYSTEM.md from publish identity fields", () => {
  const source = preparePublishSource(
    agentDir,
    { name: "呼吸科医生", role: "医生", background: "演示问诊用呼吸健康咨询助理。" },
    "zh",
  );
  expect(Buffer.from(source.files["SYSTEM.md"]!).toString("utf8")).toBe(
    "你是呼吸科医生。岗位：医生。\n\n演示问诊用呼吸健康咨询助理。\n",
  );
});

/** 示例 skill 子进程：`--import` 拦截 open-meteo / frankfurter / coingecko。 */
const mockSkillFetch = path.resolve(import.meta.dirname, "helpers/mock-skill-fetch.mjs");

function runSkillScript(scriptPath: string, args: string[]): string {
  return execFileSync(process.execPath, ["--import", mockSkillFetch, scriptPath, ...args], {
    encoding: "utf8",
    timeout: 5_000,
  });
}

it("loads and runs the weather source without MCP", () => {
  const source = loadAgentSource(weatherDir);
  expect(Object.keys(source.files).sort()).toEqual([
    "AGENTS.md",
    "skills/check-weather/SKILL.md",
    "skills/check-weather/scripts/check-weather.mjs",
  ]);
  expect(source.files["mcp.json"]).toBeUndefined();
  expect(source.avatar).toBeInstanceOf(Uint8Array);

  const output = runSkillScript(
    path.join(weatherDir, ".agentup", "skills", "check-weather", "scripts", "check-weather.mjs"),
    ["杭州"],
  );
  const weather = JSON.parse(output) as Record<string, unknown>;
  expect(weather).toMatchObject({
    city: "杭州",
    weather: "晴",
    temperature_c: 22,
    wind_level: 3,
  });
  expect(weather.details).toEqual(
    expect.objectContaining({
      feels_like_c: 21,
      humidity_pct: 60,
      wind_dir: "东",
    }),
  );
  expect(weather.sun).toEqual(expect.objectContaining({ sunrise: "06:00", sunset: "18:00" }));
  expect(Array.isArray(weather.hourly)).toBe(true);
  expect((weather.hourly as unknown[]).length).toBe(24);
  expect(Array.isArray(weather.daily)).toBe(true);
  expect((weather.daily as unknown[]).length).toBe(7);
});

it("runs weather history lookup for a past date", () => {
  const script = path.join(
    weatherDir,
    ".agentup",
    "skills",
    "check-weather",
    "scripts",
    "check-weather.mjs",
  );
  const output = runSkillScript(script, ["深圳", "2026-10-19"]);
  const history = JSON.parse(output) as Record<string, unknown>;
  expect(history).toMatchObject({
    city: "深圳",
    period: { start: "2026-10-19", end: "2026-10-19" },
  });
  expect(history.daily).toEqual([
    expect.objectContaining({
      date: "2026-10-19",
      weather: "多云",
      high_c: 28,
      low_c: 22,
      precip_mm: 0,
    }),
  ]);
  expect(Array.isArray(history.hourly)).toBe(true);
  expect((history.hourly as unknown[]).length).toBe(24);

  expect(() => runSkillScript(script, ["深圳", "2099-01-01"])).toThrow(/历史天气仅支持今天及以前/);
  expect(() => runSkillScript(script, ["杭州", "2026-10-01", "2026-11-15"])).toThrow(/最多 31 天/);
});

it("loads and runs the exchange-rate source without MCP", () => {
  const source = loadAgentSource(exchangeRateDir);
  expect(Object.keys(source.files).sort()).toEqual([
    "AGENTS.md",
    "skills/check-exchange-rate/SKILL.md",
    "skills/check-exchange-rate/scripts/check-exchange-rate.mjs",
  ]);
  expect(source.files["mcp.json"]).toBeUndefined();
  expect(source.avatar).toBeInstanceOf(Uint8Array);

  const output = runSkillScript(
    path.join(
      exchangeRateDir,
      ".agentup",
      "skills",
      "check-exchange-rate",
      "scripts",
      "check-exchange-rate.mjs",
    ),
    ["USD", "CNY", "100"],
  );
  const quote = JSON.parse(output) as Record<string, unknown>;
  expect(quote).toMatchObject({ from: "USD", to: "CNY", amount: 100, rate: 7, converted: 700 });
  expect(quote.inverse).toEqual(expect.objectContaining({ from: "CNY", to: "USD" }));
  expect(quote.change).toEqual(
    expect.objectContaining({
      day: expect.objectContaining({ pct: expect.any(Number) }),
      year: expect.objectContaining({ pct: expect.any(Number) }),
    }),
  );
});

it("loads and runs the world-clock source without MCP", () => {
  const source = loadAgentSource(worldClockDir);
  expect(Object.keys(source.files).sort()).toEqual([
    "AGENTS.md",
    "skills/check-world-clock/SKILL.md",
    "skills/check-world-clock/scripts/check-world-clock.mjs",
  ]);
  expect(source.files["mcp.json"]).toBeUndefined();
  expect(source.avatar).toBeInstanceOf(Uint8Array);

  // 「大阪」不在本地别名表，走 geocode → mock
  const output = runSkillScript(
    path.join(worldClockDir, ".agentup", "skills", "check-world-clock", "scripts", "check-world-clock.mjs"),
    ["大阪"],
  );
  const clock = JSON.parse(output) as Record<string, unknown>;
  expect(clock).toMatchObject({ city: "大阪", timezone: "Asia/Shanghai" });
  expect(typeof clock.local_time).toBe("string");
  expect(String(clock.local_time)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

it("loads and runs the crypto-price source without MCP", () => {
  const source = loadAgentSource(cryptoPriceDir);
  expect(Object.keys(source.files).sort()).toEqual([
    "AGENTS.md",
    "skills/check-crypto-price/SKILL.md",
    "skills/check-crypto-price/scripts/check-crypto-price.mjs",
  ]);
  expect(source.files["mcp.json"]).toBeUndefined();
  expect(source.avatar).toBeInstanceOf(Uint8Array);

  const output = runSkillScript(
    path.join(cryptoPriceDir, ".agentup", "skills", "check-crypto-price", "scripts", "check-crypto-price.mjs"),
    ["BTC"],
  );
  const price = JSON.parse(output) as Record<string, unknown>;
  expect(price).toMatchObject({
    id: "bitcoin",
    symbol: "BTC",
    usd: 65000,
    cny: 470000,
    change_24h_percent: 1.23,
  });
});

it("rejects a package that chooses the user", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-source-"));
  const packageRoot = path.join(dir, ".agentup");
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, "mcp.json"),
    JSON.stringify({ mcpServers: { respiratory: { url: "http://127.0.0.1:8788/mcp", headers: { "X-AgentUp-User-Id": "forged" } } } }),
  );
  try {
    loadAgentSource(dir);
    throw new Error("expected validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(AgentSourceError);
    expect((error as AgentSourceError).details).toContainEqual({
      path: "mcp.json",
      message: "mcpServers.respiratory.headers 不能写入 X-AgentUp-User-Id",
    });
  }
});

it("publishes the pi files and checks the digest", async () => {
  const prepared = preparePublishSource(
    agentDir,
    { name: "呼吸科医生", role: "医生", background: "演示问诊" },
    "zh",
  );
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 8, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0,
  ]);
  const source = { ...prepared, avatar: webp, avatarMime: "image/webp" };
  const manifest = { version: 1, tools: [], modelCapabilities: [] };
  const digest = packageDigest(manifest, source.files);
  const puts: Uint8Array[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (headers.get("authorization") !== "Bearer token" && !url.includes("myqcloud.com")) {
      return new Response(JSON.stringify({ error: "未登录" }), { status: 401 });
    }
    if (url.includes("myqcloud.com") && init?.method === "PUT") {
      const body = init.body;
      puts.push(body instanceof Uint8Array ? body : new Uint8Array());
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/uploaded")) {
      const posted = JSON.parse(String(init?.body)) as { digest?: string };
      return jsonResponse({
        job_id: "job-1",
        status: "ready",
        agent_id: "generated-id",
        name: "呼吸科医生",
        role: "医生",
        background: "演示问诊",
        manifest: { version: 1, tools: [], model_capabilities: [] },
        digest: posted.digest,
      });
    }
    if (url.endsWith("/avatar-upload")) {
      return jsonResponse({
        bucket: "agentup-test",
        region: "ap-guangzhou",
        key: "dev/avatars/agents/generated-id/1.webp",
        tmp_secret_id: "id",
        tmp_secret_key: "key",
        session_token: "token",
        content_type: "image/webp",
        expired_at: 1,
      });
    }
    if (url.includes("avatar-uploaded")) return jsonResponse({ agent_id: "generated-id" });
    return jsonResponse({
      job_id: "job-1",
      status: "awaiting_upload",
      upload: {
        bucket: "agentup-test",
        region: "ap-guangzhou",
        key: "dev/packages/generated-id/v1.tar.gz",
        tmp_secret_id: "id",
        tmp_secret_key: "key",
        session_token: "token",
        content_type: "application/gzip",
        expired_at: 1,
      },
    });
  };
  const published = await publishAgent(
    "http://127.0.0.1:9",
    "token",
    source,
    "呼吸科医生",
    "医生",
    "演示问诊",
    undefined,
    "",
    fetchImpl,
  );
  expect(published).toEqual({
    agentId: "generated-id",
    name: "呼吸科医生",
    role: "医生",
    background: "演示问诊",
    version: 1,
    digest,
  });
  expect(puts.length).toBe(2);
  const unpacked = await unpackTarGz(puts[0]!);
  expect(Buffer.from(unpacked["mcp.json"]!).toString("utf8")).toContain("http://127.0.0.1:8788/mcp");
  expect(Buffer.from(puts[1]!).toString("latin1")).toContain("WEBP");
  await expect(publishAgent(
    "http://127.0.0.1:9",
    "token",
    source,
    "呼吸科医生",
    "医生",
    "演示问诊",
    undefined,
    "",
    async () => jsonResponse({ ...publishedBody(source), status: "ready", digest: "0".repeat(64) }),
  )).rejects.toBeInstanceOf(BackendClientError);
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function publishedBody(source: ReturnType<typeof loadAgentSource>) {
  return {
    agent_id: "generated-id",
    name: "呼吸科医生",
    role: "医生",
    background: "演示问诊",
    manifest: { version: 1 },
    digest: packageDigest({ version: 1, tools: [], modelCapabilities: [] }, source.files),
  };
}

function json(res: http.ServerResponse, status: number, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { "content-type": "application/json", "content-length": body.length });
  res.end(body);
}

async function readMultipart(req: http.IncomingMessage): Promise<{
  files: Record<string, Uint8Array>;
}> {
  const contentType = req.headers["content-type"] ?? "";
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw new Error("missing multipart boundary");
  const boundary = Buffer.from(`--${match[1] ?? match[2]!}`);
  const body = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
  const files: Record<string, Uint8Array> = {};
  let start = body.indexOf(boundary);
  while (start >= 0) {
    const next = body.indexOf(boundary, start + boundary.length);
    if (next < 0) break;
    let part = body.subarray(start + boundary.length, next);
    if (part[0] === 0x0d && part[1] === 0x0a) part = part.subarray(2);
    if (part.length >= 2 && part[part.length - 2] === 0x0d && part[part.length - 1] === 0x0a) {
      part = part.subarray(0, part.length - 2);
    }
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd < 0) {
      start = next;
      continue;
    }
    const header = part.subarray(0, headerEnd).toString("utf8");
    const content = part.subarray(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/.exec(header);
    if (nameMatch && /filename="/.test(header)) {
      files[nameMatch[1]!] = new Uint8Array(content);
    }
    start = next;
  }
  return { files };
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
