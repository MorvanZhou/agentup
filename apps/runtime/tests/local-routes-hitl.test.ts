import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { startLocalServer } from "../src/local/server.js";

it("validates approval and ask_user loopback decisions", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-hitl-"));
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  const headers = { authorization: "Bearer token", "content-type": "application/json" };
  try {
    expect((await fetch(`${local.url}/approvals/missing`, { method: "POST", headers, body: "{}" })).status).toBe(400);
    expect(
      (
        await fetch(`${local.url}/approvals/missing`, {
          method: "POST",
          headers,
          body: JSON.stringify({ allow: true, scope: "forever" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${local.url}/approvals/missing`, {
          method: "POST",
          headers,
          body: JSON.stringify({ allow: false, scope: "session" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${local.url}/approvals/missing`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ allow: true }),
        })
      ).status,
    ).toBe(401);
    const expired = await fetch(`${local.url}/approvals/missing`, {
      method: "POST",
      headers,
      body: JSON.stringify({ allow: true, scope: "once" }),
    });
    expect(expired.status).toBe(404);
    expect(await expired.json()).toMatchObject({ error: "审批请求已失效" });

    expect((await fetch(`${local.url}/ask-user/missing`, { method: "POST", headers, body: "{}" })).status).toBe(400);
    expect(
      (
        await fetch(`${local.url}/ask-user/missing`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cancelled: true }),
        })
      ).status,
    ).toBe(401);
    const askExpired = await fetch(`${local.url}/ask-user/missing`, {
      method: "POST",
      headers,
      body: JSON.stringify({ cancelled: true }),
    });
    expect(askExpired.status).toBe(404);
    expect(await askExpired.json()).toMatchObject({ error: "提问请求已失效" });

    const answered = await fetch(`${local.url}/ask-user/missing`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        answer: { kind: "answers", items: [{ kind: "selection", selections: ["Postgres"] }] },
      }),
    });
    expect(answered.status).toBe(404);
  } finally {
    await local.close();
  }
});
