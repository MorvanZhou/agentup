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
  const webp = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 8, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0,
  ]).toString("base64");
  const backend = await listen((req, res) => {
    const token = req.headers.authorization?.slice("Bearer ".length);
    if (req.method === "PUT" && (req.url ?? "").includes(".webp")) {
      res.writeHead(200);
      res.end();
      return;
    }
    if (!token) return json(res, 401, { error: "未登录" });
    if (req.url === "/v1/me/avatar-upload" && req.method === "POST") {
      const host = req.headers.host ?? "127.0.0.1";
      return json(res, 200, {
        bucket: host,
        region: "local",
        key: "dev/avatars/users/u-a/1.webp",
        tmp_secret_id: "id",
        tmp_secret_key: "key",
        session_token: "token",
        content_type: "image/webp",
        expired_at: 1,
      });
    }
    if (req.url?.startsWith("/v1/me/avatar-uploaded") && req.method === "POST") {
      const current = accounts.get(token);
      if (!current) return json(res, 401, { error: "未登录" });
      const next = {
        ...current,
        has_avatar: true,
        avatar_url: "https://agentup-test.cos.ap-guangzhou.myqcloud.com/dev/avatars/users/u-a/1.webp?q-sign-time=1",
      };
      accounts.set(token, next);
      return json(res, 200, { ...next, token });
    }
    if (req.url === "/v1/me" && req.method === "PUT") {
      return readBody(req).then((raw) => {
        const body = JSON.parse(raw) as { nickname?: string };
        const current = accounts.get(token);
        if (!current) return json(res, 401, { error: "未登录" });
        if (!body.nickname || body.nickname !== body.nickname.trim()) {
          return json(res, 400, { error: "昵称无效" });
        }
        accounts.set(token, { ...current, nickname: body.nickname });
        json(res, 200, {
          user_id: current.user_id,
          email: current.email,
          nickname: body.nickname,
          token,
          has_avatar: current.has_avatar,
          avatar_url: current.avatar_url,
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
      body: JSON.stringify({ nickname: "小舟", avatar: webp }),
    });
    expect(withAvatar.status).toBe(200);
    const body = (await withAvatar.json()) as {
      user_id: string;
      email: string;
      nickname: string;
      token: string;
      has_avatar: boolean;
      avatar_url: string | null;
    };
    expect(body).toMatchObject({
      user_id: "u-a",
      email: "alice@example.com",
      nickname: "小舟",
      token: "token-a",
      has_avatar: true,
    });
    // 上传字节直接写入本机缓存，会话返回 data URL 而非易过期的签名 GET
    expect(body.avatar_url).toMatch(/^data:image\/webp;base64,/);
    expect(
      fs.existsSync(path.join(root, "users/u-a/account/assets/avatar.webp")),
    ).toBe(true);

    const cached = await fetch(`${local.url}/local/account-avatar?user_id=u-a`);
    expect(cached.status).toBe(200);
    expect(await cached.json()).toEqual({ avatar_url: body.avatar_url });
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
