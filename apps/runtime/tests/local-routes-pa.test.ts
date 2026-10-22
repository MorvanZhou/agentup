import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { ATTACHMENTS_DIR } from "../src/session/workspace/attachments.js";
import { startLocalServer } from "../src/local/server.js";

it("serves personal-assistant history, context, attachments, and delegations", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pa-routes-"));
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  const headers = { authorization: "Bearer token", "content-type": "application/json" };
  try {
    expect((await fetch(`${local.url}/personal-assistant/history?user_id=patient`, { headers })).status).toBe(200);
    expect(await (await fetch(`${local.url}/personal-assistant/history?user_id=patient`, { headers })).json()).toEqual({
      messages: [],
    });
    expect((await fetch(`${local.url}/personal-assistant/history?user_id=patient`)).status).toBe(401);

    const clearedContext = await fetch(`${local.url}/personal-assistant/context`, {
      method: "POST",
      headers,
      body: JSON.stringify({ user_id: "patient" }),
    });
    expect(clearedContext.status).toBe(200);
    expect(await clearedContext.json()).toEqual({ cleared: true });

    const clearedHistory = await fetch(`${local.url}/personal-assistant/history?user_id=patient`, {
      method: "DELETE",
      headers: { authorization: "Bearer token" },
    });
    expect(clearedHistory.status).toBe(200);
    expect(await clearedHistory.json()).toEqual({ cleared: true });

    const note = Buffer.from("hello note", "utf8").toString("base64");
    const staged = await fetch(`${local.url}/personal-assistant/attachments`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user_id: "patient",
        name: "note.txt",
        media_type: "text/plain",
        data_base64: note,
      }),
    });
    expect(staged.status).toBe(200);
    const attachment = (await staged.json()) as { path: string; name: string; media_type: string };
    expect(attachment).toMatchObject({ name: "note.txt", media_type: "text/plain" });
    expect(attachment.path.startsWith(`${ATTACHMENTS_DIR}/`)).toBe(true);
    expect(
      fs.existsSync(path.join(root, "users", "patient", "personal-assistant", "cwd", attachment.path)),
    ).toBe(true);

    const removed = await fetch(
      `${local.url}/personal-assistant/attachments?user_id=patient&path=${encodeURIComponent(attachment.path)}`,
      { method: "DELETE", headers: { authorization: "Bearer token" } },
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ deleted: true });
    expect(
      fs.existsSync(path.join(root, "users", "patient", "personal-assistant", "cwd", attachment.path)),
    ).toBe(false);

    const listed = await fetch(`${local.url}/personal-assistant/delegations?user_id=patient`, { headers });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ tasks: [] });

    const missingAck = await fetch(`${local.url}/personal-assistant/delegations/missing/ack`, {
      method: "POST",
      headers,
      body: JSON.stringify({ user_id: "patient" }),
    });
    expect(missingAck.status).toBe(404);

    const missingHistory = await fetch(
      `${local.url}/personal-assistant/delegations/missing/history?user_id=patient`,
      { headers },
    );
    expect(missingHistory.status).toBe(404);

    const missingStream = await fetch(
      `${local.url}/personal-assistant/delegations/missing/stream?user_id=patient`,
      { headers },
    );
    expect(missingStream.status).toBe(404);
  } finally {
    await local.close();
  }
});

it("stages and deletes agent attachments through the loopback API", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-agent-attach-"));
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  const headers = { authorization: "Bearer token", "content-type": "application/json" };
  try {
    const note = Buffer.from("agent note", "utf8").toString("base64");
    const staged = await fetch(`${local.url}/agents/weather/attachments`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user_id: "patient",
        name: "note.txt",
        media_type: "text/plain",
        data_base64: note,
      }),
    });
    expect(staged.status).toBe(200);
    const attachment = (await staged.json()) as { path: string };
    expect(fs.existsSync(path.join(root, "users", "patient", "agents", "weather", "cwd", attachment.path))).toBe(
      true,
    );

    const removed = await fetch(
      `${local.url}/agents/weather/attachments?user_id=patient&path=${encodeURIComponent(attachment.path)}`,
      { method: "DELETE", headers: { authorization: "Bearer token" } },
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ deleted: true });
    expect(fs.existsSync(path.join(root, "users", "patient", "agents", "weather", "cwd", attachment.path))).toBe(
      false,
    );

    expect(
      (
        await fetch(`${local.url}/agents/../evil/attachments`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            user_id: "patient",
            name: "x.txt",
            media_type: "text/plain",
            data_base64: note,
          }),
        })
      ).status,
    ).toBe(404);
  } finally {
    await local.close();
  }
});
