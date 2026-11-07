import http from "node:http";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { publishAgent } from "../src/control/client.js";
import { HttpPackageSource } from "../src/control/package-source.js";
import { md5Hex } from "../src/package/capability.js";

const skillMd = Buffer.from("---\nname: intake\ndescription: Collect intake details.\n---\n\nhello\n");
const mcpJson = Buffer.from('{"mcpServers":{"demo":{"url":"http://127.0.0.1:9/mcp"}}}\n');

it("uploads changed objects and installs them without the whole archive", async () => {
  const stored = new Map<string, Uint8Array>();
  const puts: { url: string; forbid: string | null }[] = [];
  let skillsField = "";
  const backend = await listen(async (req, res) => {
    const url = req.url ?? "";
    if (req.method === "PUT") {
      stored.set(url, new Uint8Array(await readRaw(req)));
      puts.push({ url, forbid: req.headers["x-cos-forbid-overwrite"] ?? null });
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === "POST" && url.endsWith("/uploaded")) {
      return json(res, 200, {
        job_id: "job-1",
        status: "ready",
        agent_id: "agent1",
        name: "顾问",
        role: "税务",
        background: "背景",
        manifest: { version: 1, tools: [], model_capabilities: [] },
        digest: "cd".repeat(32),
      });
    }
    if (req.method === "POST" && url === "/v1/agents") {
      const { fields } = await readMultipart(req);
      skillsField = fields.skills ?? "";
      const host = `127.0.0.1:${(req.socket.localPort ?? 0).toString()}`;
      const grant = (key: string, contentType: string) => ({
        bucket: host,
        region: "local",
        key,
        tmp_secret_id: "id",
        tmp_secret_key: "key",
        session_token: "token",
        content_type: contentType,
        expired_at: 1,
      });
      return json(res, 202, {
        job_id: "job-1",
        status: "awaiting_upload",
        uploads: [
          grant("dev/agents/agent1/skills/intake.tar.gz", "application/gzip"),
          grant("dev/agents/agent1/mcp.json", "application/json"),
        ],
      });
    }
    if (req.method === "GET" && url === "/v1/agents/agent1/package") {
      const skillKey = "dev/agents/agent1/skills/intake.tar.gz";
      const mcpKey = "dev/agents/agent1/mcp.json";
      const skillBytes = [...stored.values()].find((body) => body[0] === 0x1f) ?? new Uint8Array();
      const mcpBytes = [...stored.values()].find((body) => body[0] === 0x7b) ?? new Uint8Array();
      const host = `127.0.0.1:${(req.socket.localPort ?? 0).toString()}`;
      const grant = (key: string, md5: string, name = "") => ({
        name,
        md5,
        bucket: host,
        region: "local",
        key,
        tmp_secret_id: "id",
        tmp_secret_key: "key",
        session_token: "token",
        expired_at: 1,
      });
      return json(res, 200, {
        agent_id: "agent1",
        version: 1,
        digest: "cd".repeat(32),
        name: "顾问",
        role: "税务",
        background: "背景",
        rules: "只谈税务",
        skills: [grant(skillKey, md5Hex(skillBytes), "intake")],
        mcp: grant(mcpKey, md5Hex(mcpBytes)),
      });
    }
    const object = stored.get(url);
    if (req.method === "GET" && object) {
      res.writeHead(200);
      res.end(Buffer.from(object));
      return;
    }
    return json(res, 404, { error: "没有这个接口" });
  });
  const backendUrl = `http://127.0.0.1:${backend.address.port}`;
  try {
    const published = await publishAgent(
      backendUrl,
      "token",
      {
        files: {
          "SYSTEM.md": Buffer.from("占位\n"),
          "AGENTS.md": Buffer.from("只谈税务\n"),
          "skills/intake/SKILL.md": skillMd,
          "mcp.json": mcpJson,
        },
      },
      "顾问",
      "税务",
      "背景",
      undefined,
      "只谈税务",
      fetch,
    );
    expect(published.digest).toBe("cd".repeat(32));
    expect(JSON.parse(skillsField)).toEqual([
      { name: "intake", md5: expect.stringMatching(/^[a-f0-9]{32}$/) },
    ]);
    expect(puts).toHaveLength(2);
    expect(puts.every((item) => item.forbid === null)).toBe(true);
    expect([...stored.keys()].some((item) => item.endsWith("/skills/intake.tar.gz"))).toBe(true);
    expect([...stored.keys()].some((item) => item.endsWith("/mcp.json"))).toBe(true);

    const release = await new HttpPackageSource(backendUrl, "token").getPackage("agent1");
    expect(Buffer.from(release.files["SYSTEM.md"]!).toString("utf8")).toBe("你是顾问。岗位：税务。\n\n背景\n");
    expect(Buffer.from(release.files["AGENTS.md"]!).toString("utf8")).toBe("只谈税务\n");
    expect(Buffer.from(release.files["skills/intake/SKILL.md"]!).toString("utf8")).toBe(skillMd.toString("utf8"));
    expect(Buffer.from(release.files["mcp.json"]!).toString("utf8")).toBe(mcpJson.toString("utf8"));
    expect(release.files["SYSTEM.md"] && release.digest).toBeTruthy();
    expect(release.digest).not.toBe("cd".repeat(32));
  } finally {
    await close(backend);
  }
});

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

async function readMultipart(req: http.IncomingMessage): Promise<{ fields: Record<string, string> }> {
  const contentType = req.headers["content-type"] ?? "";
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw new Error("missing multipart boundary");
  const boundary = Buffer.from(`--${match[1] ?? match[2]!}`);
  const body = await readRaw(req);
  const fields: Record<string, string> = {};
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
    if (headerEnd >= 0) {
      const header = part.subarray(0, headerEnd).toString("utf8");
      const name = /name="([^"]+)"/.exec(header)?.[1];
      if (name && !/filename="/.test(header)) fields[name] = part.subarray(headerEnd + 4).toString("utf8");
    }
    start = next;
  }
  return { fields };
}
