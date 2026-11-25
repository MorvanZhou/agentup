/** 团队列表成员头像：落到本机 data URL；同 rev 不重拉，rev 变才更新。 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { startLocalServer } from "../src/local/server.js";

const agentId = "Weaty01";
const teamId = "teamPack1";

/** 最小合法 WebP：RIFF....WEBP */
function tinyWebp(): Buffer {
  const buf = Buffer.alloc(12);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(4, 4);
  buf.write("WEBP", 8);
  return buf;
}

it("GET /teams caches member avatars as data URLs and skips refetch for same rev", async () => {
  const webp = tinyWebp();
  let avatarHits = 0;
  const backend = await listen((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/avatars/agents/") && req.method === "GET") {
      avatarHits += 1;
      res.writeHead(200, { "content-type": "image/webp", "content-length": webp.length });
      res.end(webp);
      return;
    }
    if (url.startsWith("/v1/teams") && req.method === "GET") {
      const host = `http://127.0.0.1:${backend.address.port}`;
      return json(res, 200, {
        teams: [
          {
            team_id: teamId,
            name: "气象小队",
            background: "一起看天气",
            default_holder_agent_id: agentId,
            members: [
              {
                agent_id: agentId,
                name: "Weaty",
                role: "气象员",
                sort_order: 0,
                has_avatar: true,
                avatar_url: `${host}/avatars/agents/${agentId}/1.webp?q-sign=a`,
              },
            ],
            recruited: false,
            has_avatar: false,
            recruit_count: 0,
            created_at: "now",
            updated_at: "now",
          },
        ],
      });
    }
    return json(res, 404, { error: "没有这个接口" });
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-team-avatar-"));
  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const first = await fetch(`${local.url}/teams?user_id=guest`, {
      headers: { authorization: "Bearer guest" },
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      teams: Array<{ members: Array<{ avatar_url?: string }> }>;
    };
    const firstUrl = firstBody.teams[0]?.members[0]?.avatar_url;
    expect(firstUrl).toMatch(/^data:image\/webp;base64,/);
    expect(avatarHits).toBe(1);
    expect(
      fs.existsSync(path.join(root, "users/guest/agents", agentId, "assets/avatar.webp")),
    ).toBe(true);

    const second = await fetch(`${local.url}/teams?user_id=guest`, {
      headers: { authorization: "Bearer guest" },
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      teams: Array<{ members: Array<{ avatar_url?: string }> }>;
    };
    expect(secondBody.teams[0]?.members[0]?.avatar_url).toBe(firstUrl);
    // 仅签名变、rev 同：不应再打远端
    expect(avatarHits).toBe(1);
  } finally {
    await local.close();
    backend.server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("GET /teams/public re-fetches member avatar when rev path changes", async () => {
  const webpV1 = tinyWebp();
  // 同签名、不同载荷，方便断言 cache 已换
  const webpV2 = Buffer.alloc(12);
  webpV2.write("RIFF", 0);
  webpV2.writeUInt32LE(8, 4);
  webpV2.write("WEBP", 8);

  let serveRev = 1;
  let avatarHits = 0;
  const backend = await listen((req, res) => {
    const url = req.url ?? "";
    const avatarMatch = /^\/avatars\/agents\/[^/]+\/(\d+)\.webp/.exec(url.split("?")[0] ?? "");
    if (avatarMatch && req.method === "GET") {
      avatarHits += 1;
      const body = Number(avatarMatch[1]) >= 2 ? webpV2 : webpV1;
      res.writeHead(200, { "content-type": "image/webp", "content-length": body.length });
      res.end(body);
      return;
    }
    if (url.startsWith("/v1/teams/public") && req.method === "GET") {
      const host = `http://127.0.0.1:${backend.address.port}`;
      return json(res, 200, {
        teams: [
          {
            team_id: teamId,
            name: "气象小队",
            background: "一起看天气",
            default_holder_agent_id: agentId,
            members: [
              {
                agent_id: agentId,
                name: "Weaty",
                role: "气象员",
                sort_order: 0,
                has_avatar: true,
                avatar_url: `${host}/avatars/agents/${agentId}/${serveRev}.webp?q-sign=z`,
              },
            ],
            recruited: false,
            has_avatar: false,
            recruit_count: 0,
            created_at: "now",
            updated_at: "now",
          },
        ],
      });
    }
    return json(res, 404, { error: "没有这个接口" });
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-team-avatar-pub-"));
  const local = await startLocalServer({
    backendUrl: `http://127.0.0.1:${backend.address.port}`,
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const first = await fetch(`${local.url}/teams/public?user_id=guest`);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      teams: Array<{ members: Array<{ avatar_url?: string }> }>;
    };
    const firstUrl = firstBody.teams[0]?.members[0]?.avatar_url;
    expect(firstUrl).toMatch(/^data:image\/webp;base64,/);
    expect(avatarHits).toBe(1);

    serveRev = 2;
    const second = await fetch(`${local.url}/teams/public?user_id=guest`);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      teams: Array<{ members: Array<{ avatar_url?: string }> }>;
    };
    const secondUrl = secondBody.teams[0]?.members[0]?.avatar_url;
    expect(secondUrl).toMatch(/^data:image\/webp;base64,/);
    expect(secondUrl).not.toBe(firstUrl);
    expect(avatarHits).toBe(2);
  } finally {
    await local.close();
    backend.server.close();
    fs.rmSync(root, { recursive: true, force: true });
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
