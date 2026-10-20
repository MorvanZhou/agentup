import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { expect, it } from "vitest";

import { startLocalServer } from "../src/local/server.js";

it("proxies account preferences through the loopback API", async () => {
  const store = new Map<string, { theme_mode: string; skip_edit_resend_confirm: boolean }>();
  const backend = await listen((req, res) => {
    const token = req.headers.authorization?.slice("Bearer ".length);
    if (!token) return json(res, 401, { error: "未登录" });
    if (req.url === "/v1/me/preferences" && req.method === "GET") {
      const prefs = store.get(token) ?? { theme_mode: "system", skip_edit_resend_confirm: false };
      return json(res, 200, prefs);
    }
    if (req.url === "/v1/me/preferences" && req.method === "PUT") {
      return readBody(req).then((raw) => {
        const body = JSON.parse(raw) as {
          theme_mode?: string;
          skip_edit_resend_confirm?: boolean;
        };
        const current = store.get(token) ?? {
          theme_mode: "system",
          skip_edit_resend_confirm: false,
        };
        const next = {
          theme_mode: body.theme_mode ?? current.theme_mode,
          skip_edit_resend_confirm:
            body.skip_edit_resend_confirm ?? current.skip_edit_resend_confirm,
        };
        store.set(token, next);
        json(res, 200, next);
      });
    }
    json(res, 404, { error: "not found" });
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-prefs-"));
  const local = await startLocalServer({
    backendUrl: backend.url,
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const empty = await fetch(`${local.url}/preferences`, {
      headers: { authorization: "Bearer alice" },
    });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({
      theme_mode: "system",
      skip_edit_resend_confirm: false,
      ui_locale: "zh",
    });

    const saved = await fetch(`${local.url}/preferences`, {
      method: "PUT",
      headers: { authorization: "Bearer alice", "content-type": "application/json" },
      body: JSON.stringify({ theme_mode: "dark" }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      theme_mode: "dark",
      skip_edit_resend_confirm: false,
      ui_locale: "zh",
    });
    expect(store.get("alice")).toEqual({
      theme_mode: "dark",
      skip_edit_resend_confirm: false,
    });

    const skipped = await fetch(`${local.url}/preferences`, {
      method: "PUT",
      headers: { authorization: "Bearer alice", "content-type": "application/json" },
      body: JSON.stringify({ skip_edit_resend_confirm: true }),
    });
    expect(skipped.status).toBe(200);
    expect(await skipped.json()).toEqual({
      theme_mode: "dark",
      skip_edit_resend_confirm: true,
      ui_locale: "zh",
    });

    const other = await fetch(`${local.url}/preferences`, {
      headers: { authorization: "Bearer bob" },
    });
    expect(await other.json()).toEqual({
      theme_mode: "system",
      skip_edit_resend_confirm: false,
      ui_locale: "zh",
    });

    const bad = await fetch(`${local.url}/preferences`, {
      method: "PUT",
      headers: { authorization: "Bearer alice", "content-type": "application/json" },
      body: JSON.stringify({ theme_mode: "neon" }),
    });
    expect(bad.status).toBe(400);
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
