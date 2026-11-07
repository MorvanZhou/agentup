/** 团队一键招募：全员 sync 成功才建群；部分失败不建群。 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { packTarGz } from "../src/package/archive.js";
import { packageDigest } from "../src/package/digest.js";
import { startLocalServer } from "../src/local/server.js";

const agentA = "teamagentA";
const agentB = "teamagentB";
const teamId = "teamPack1";

const filesA = { "SYSTEM.md": Buffer.from("你是澄清官") };
const filesB = { "SYSTEM.md": Buffer.from("你是实现者") };
const manifest = { version: 1, tools: [] as string[], modelCapabilities: [] as string[] };
const digestA = packageDigest(manifest, filesA);
const digestB = packageDigest(manifest, filesB);
const archiveA = packTarGz(filesA);
const archiveB = packTarGz(filesB);

it("recruits team members, syncs all, and creates a group with sourceTeamId", async () => {
  const backend = await listen((req, res) => {
    const url = req.url ?? "";
    if (url === "/v1/login" && req.method === "POST") {
      return readBody(req).then((raw) => {
        const body = JSON.parse(raw) as { email: string };
        const local = body.email.split("@")[0] ?? body.email;
        json(res, 200, { user_id: local, email: body.email, nickname: local, token: local });
      });
    }
    if (url === "/v1/register" && req.method === "POST") {
      return readBody(req).then((raw) => {
        const body = JSON.parse(raw) as { email: string };
        json(res, 200, { email: body.email, status: "pending_verification" });
      });
    }
    const token = req.headers.authorization?.slice("Bearer ".length);
    if (!token) return json(res, 401, { error: "未登录" });

    if (url === `/v1/teams/${teamId}/recruit` && req.method === "POST") {
      return json(res, 200, {
        team_id: teamId,
        name: "开发小队",
        default_holder_agent_id: agentA,
        members: [
          { agent_id: agentA, name: "澄清官", role: "澄清", sort_order: 0 },
          { agent_id: agentB, name: "实现者", role: "实现", sort_order: 1 },
        ],
      });
    }
    if (url === "/v1/recruits") {
      return json(res, 200, {
        recruits: [
          {
            user_id: token,
            agent_id: agentA,
            name: "澄清官",
            latest_version: 1,
            latest_digest: digestA,
          },
          {
            user_id: token,
            agent_id: agentB,
            name: "实现者",
            latest_version: 1,
            latest_digest: digestB,
          },
        ],
      });
    }
    if (url === `/v1/agents/${agentA}/package`) {
      return archiveA.then((archive) => sendPackage(res, agentA, digestA, "澄清官", archive));
    }
    if (url === `/v1/agents/${agentB}/package`) {
      return archiveB.then((archive) => sendPackage(res, agentB, digestB, "实现者", archive));
    }
    if (url === "/v1/groups" && req.method === "POST") {
      return readBody(req).then((raw) => {
        const body = JSON.parse(raw) as { group_id: string; title: string; members: string[] };
        json(res, 200, {
          group_id: body.group_id,
          title: body.title,
          members: body.members,
          created_at: "now",
          updated_at: "now",
        });
      });
    }
    if (url === "/v1/groups" && req.method === "GET") {
      return json(res, 200, { groups: [] });
    }
    return json(res, 404, { error: "没有这个接口" });
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-team-"));
  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const account = await createAccount(local.url, "team-user@example.com");
    const result = await postJson(
      local.url,
      `/teams/${teamId}/recruit`,
      { user_id: account.user_id },
      String(account.token),
    );
    expect(result.team_id).toBe(teamId);
    expect(result.name).toBe("开发小队");
    const group = result.group as {
      id: string;
      title: string;
      defaultHolderId: string;
      sourceTeamId?: string;
      members: { agentId: string; name: string }[];
    };
    expect(group.title).toBe("开发小队");
    expect(group.defaultHolderId).toBe(agentA);
    expect(group.sourceTeamId).toBe(teamId);
    expect(group.members.map((m) => m.agentId)).toEqual([agentA, agentB]);
    expect(
      fs.existsSync(path.join(root, "users", String(account.user_id), "agents", agentA, "cwd", ".pi", "SYSTEM.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, "users", String(account.user_id), "agents", agentB, "cwd", ".pi", "SYSTEM.md")),
    ).toBe(true);
  } finally {
    await local.close();
    await close(backend);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("does not create a group when a member sync fails", async () => {
  const backend = await listen((req, res) => {
    const url = req.url ?? "";
    if (url === "/v1/login" && req.method === "POST") {
      return readBody(req).then((raw) => {
        const body = JSON.parse(raw) as { email: string };
        const local = body.email.split("@")[0] ?? body.email;
        json(res, 200, { user_id: local, email: body.email, nickname: local, token: local });
      });
    }
    if (url === "/v1/register" && req.method === "POST") {
      return readBody(req).then((raw) => {
        const body = JSON.parse(raw) as { email: string };
        json(res, 200, { email: body.email, status: "pending_verification" });
      });
    }
    const token = req.headers.authorization?.slice("Bearer ".length);
    if (!token) return json(res, 401, { error: "未登录" });
    if (url === `/v1/teams/${teamId}/recruit` && req.method === "POST") {
      return json(res, 200, {
        team_id: teamId,
        name: "开发小队",
        default_holder_agent_id: agentA,
        members: [
          { agent_id: agentA, name: "澄清官", role: "澄清", sort_order: 0 },
          { agent_id: agentB, name: "实现者", role: "实现", sort_order: 1 },
        ],
      });
    }
    if (url === "/v1/recruits") {
      return json(res, 200, {
        recruits: [
          {
            user_id: token,
            agent_id: agentA,
            name: "澄清官",
            latest_version: 1,
            latest_digest: digestA,
          },
          {
            user_id: token,
            agent_id: agentB,
            name: "实现者",
            latest_version: 1,
            latest_digest: digestB,
          },
        ],
      });
    }
    if (url === `/v1/agents/${agentA}/package`) {
      return archiveA.then((archive) => sendPackage(res, agentA, digestA, "澄清官", archive));
    }
    if (url === `/v1/agents/${agentB}/package`) {
      return json(res, 500, { error: "包坏了" });
    }
    if (url === "/v1/groups") {
      return json(res, 200, { groups: [] });
    }
    return json(res, 404, { error: "没有这个接口" });
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-team-fail-"));
  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const account = await createAccount(local.url, "team-fail@example.com");
    const response = await fetch(`${local.url}/teams/${teamId}/recruit`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${String(account.token)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ user_id: account.user_id }),
    });
    expect(response.status).toBe(502);
    const payload = (await response.json()) as {
      code?: string;
      failed?: { agent_id: string }[];
    };
    expect(payload.code).toBe("team_sync_partial");
    expect(payload.failed?.map((item) => item.agent_id)).toEqual([agentB]);
    const groupsDir = path.join(root, "users", String(account.user_id), ".runtime", "groups");
    expect(fs.existsSync(groupsDir) ? fs.readdirSync(groupsDir).filter((n) => n.endsWith(".json")) : []).toEqual(
      [],
    );
  } finally {
    await local.close();
    await close(backend);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function sendPackage(
  res: http.ServerResponse,
  agentId: string,
  digest: string,
  name: string,
  archive: Uint8Array,
) {
  const body = Buffer.from(archive);
  res.writeHead(200, {
    "content-type": "application/gzip",
    "content-length": body.length,
    "x-agent-id": agentId,
    "x-package-version": "1",
    "x-package-digest": digest,
    "x-package-name": encodeURIComponent(name),
    "x-package-background": encodeURIComponent("demo"),
  });
  res.end(body);
}

async function createAccount(base: string, email: string) {
  await postJson(base, "/register", { email, password: "secret12" });
  return postJson(base, "/login", { email, password: "secret12" });
}

async function postJson(base: string, pathName: string, body: unknown, token?: string) {
  const response = await fetch(`${base}${pathName}`, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(payload)}`);
  return payload;
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
