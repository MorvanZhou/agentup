import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { startLocalServer } from "../src/local/server.js";

it("proxies account profile updates through the loopback API", async () => {
  const accounts = new Map<
    string,
    { user_id: string; email: string; nickname: string; has_avatar: boolean; avatar_url: string | null }
  >([
    [
      "token-a",
      {
        user_id: "u-a",
        email: "alice@example.com",
        nickname: "alice",
        has_avatar: false,
        avatar_url: null,
      },
    ],
  ]);
  const backend = await listen((req, res) => {
    const token = req.headers.authorization?.slice("Bearer ".length);
    if (!token) return json(res, 401, { error: "未登录" });
    if (req.url === "/v1/me" && req.method === "PUT") {
      return readBody(req).then((raw) => {
        const body = JSON.parse(raw) as { nickname?: string; avatar?: string };
        const current = accounts.get(token);
        if (!current) return json(res, 401, { error: "未登录" });
        if (!body.nickname || body.nickname !== body.nickname.trim()) {
          return json(res, 400, { error: "昵称无效" });
        }
        const hasAvatar = typeof body.avatar === "string" && body.avatar.length > 0 ? true : current.has_avatar;
        const avatarUrl = hasAvatar
          ? `http://backend.test/statics/users/${current.user_id}/avatar.webp?v=1`
          : null;
        accounts.set(token, {
          ...current,
          nickname: body.nickname,
          has_avatar: hasAvatar,
          avatar_url: avatarUrl,
        });
        json(res, 200, {
          user_id: current.user_id,
          email: current.email,
          nickname: body.nickname,
          token,
          has_avatar: hasAvatar,
          avatar_url: avatarUrl,
        });
      });
    }
    json(res, 404, { error: "not found" });
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-profile-"));
  const local = await startLocalServer({
    backendUrl: backend.url,
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const saved = await fetch(`${local.url}/me`, {
      method: "PUT",
      headers: { authorization: "Bearer token-a", "content-type": "application/json" },
      body: JSON.stringify({ nickname: "小舟" }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      user_id: "u-a",
      email: "alice@example.com",
      nickname: "小舟",
      token: "token-a",
      has_avatar: false,
      avatar_url: null,
    });
    expect(accounts.get("token-a")).toMatchObject({
      user_id: "u-a",
      email: "alice@example.com",
      nickname: "小舟",
      has_avatar: false,
    });

    const withAvatar = await fetch(`${local.url}/me`, {
      method: "PUT",
      headers: { authorization: "Bearer token-a", "content-type": "application/json" },
      body: JSON.stringify({ nickname: "小舟", avatar: "AAAA" }),
    });
    expect(withAvatar.status).toBe(200);
    expect(await withAvatar.json()).toEqual({
      user_id: "u-a",
      email: "alice@example.com",
      nickname: "小舟",
      token: "token-a",
      has_avatar: true,
      avatar_url: "http://backend.test/statics/users/u-a/avatar.webp?v=1",
    });
  } finally {
    await local.close();
    await backend.close();
  }
});

function listen(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
    server.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
