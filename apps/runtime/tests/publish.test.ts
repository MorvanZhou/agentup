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

const agentDir = path.resolve(import.meta.dirname, "../../agent_examples/respiratory-doctor/agent");
const weatherDir = path.resolve(import.meta.dirname, "../../agent_examples/weather/agent");
const exchangeRateDir = path.resolve(import.meta.dirname, "../../agent_examples/exchange-rate/agent");
const worldClockDir = path.resolve(import.meta.dirname, "../../agent_examples/world-clock/agent");
const cryptoPriceDir = path.resolve(import.meta.dirname, "../../agent_examples/crypto-price/agent");

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
  const source = preparePublishSource(
    agentDir,
    { name: "呼吸科医生", role: "医生", background: "演示问诊" },
    "zh",
  );
  const manifest = { version: 1, tools: [], modelCapabilities: [] };
  const digest = packageDigest(manifest, source.files);
  let postedArchive: Uint8Array | undefined;
  let postedAvatar = false;
  const server = await listen(async (req, res) => {
    if (req.headers.authorization !== "Bearer token") return json(res, 401, { error: "未登录" });
    const { files } = await readMultipart(req);
    postedArchive = files.archive;
    postedAvatar = Boolean(files.avatar?.byteLength);
    json(res, 200, {
      job_id: "job-1",
      status: "ready",
      agent_id: "generated-id",
      name: "呼吸科医生",
      role: "医生",
      background: "演示问诊",
      manifest: {
        version: 1,
        tools: [],
        model_capabilities: [],
      },
      digest,
      byte_size: postedArchive?.byteLength ?? 0,
    });
  });
  try {
    const published = await publishAgent(
      `http://127.0.0.1:${server.address.port}`,
      "token",
      source,
      "呼吸科医生",
      "医生",
      "演示问诊",
    );
    expect(published).toEqual({
      agentId: "generated-id",
      name: "呼吸科医生",
      role: "医生",
      background: "演示问诊",
      version: 1,
      digest,
    });
    expect(postedArchive).toBeTruthy();
    const unpacked = await unpackTarGz(postedArchive!);
    expect(Buffer.from(unpacked["mcp.json"]!).toString("utf8")).toContain("http://127.0.0.1:8788/mcp");
    expect(postedAvatar).toBe(true);
    await expect(publishAgent(
      `http://127.0.0.1:${server.address.port}`,
      "token",
      source,
      "呼吸科医生",
      "医生",
      "演示问诊",
      undefined,
      "",
      async () => new Response(JSON.stringify({ ...publishedBody(source), digest: "0".repeat(64) }), { status: 200 }),
    )).rejects.toBeInstanceOf(BackendClientError);
  } finally {
    await close(server);
  }
});

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
