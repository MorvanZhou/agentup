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

it("stages agent attachments by copying from a local path", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-agent-path-"));
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  const headers = { authorization: "Bearer token", "content-type": "application/json" };
  try {
    // 源文件放在 userDataRoot 之外：验证任意本机路径都能复制进工作区
    const source = path.join(os.tmpdir(), "agentup-path-source.txt");
    fs.writeFileSync(source, "copied content");

    const staged = await fetch(`${local.url}/agents/weather/attachments/from-path`, {
      method: "POST",
      headers,
      body: JSON.stringify({ user_id: "patient", path: source, name: "my note.txt" }),
    });
    expect(staged.status).toBe(200);
    const attachment = (await staged.json()) as { path: string; name: string; media_type: string };
    expect(attachment.name).toBe("my_note.txt");
    expect(attachment.media_type).toBe("application/octet-stream");
    expect(
      fs.readFileSync(path.join(root, "users", "patient", "agents", "weather", "cwd", attachment.path), "utf8"),
    ).toBe("copied content");

    // 不存在的源路径：400，不落盘
    const missing = await fetch(`${local.url}/agents/weather/attachments/from-path`, {
      method: "POST",
      headers,
      body: JSON.stringify({ user_id: "patient", path: path.join(root, "nope.bin") }),
    });
    expect(missing.status).toBe(400);
  } finally {
    await local.close();
  }
});

it("stages group attachments with the same name format as one-to-one chats", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-attach-"));
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  const headers = { authorization: "Bearer token", "content-type": "application/json" };
  try {
    // 群 store 落一个最小房间记录，绕开需要真实 backend 的建群流程
    const groupsDir = path.join(root, "users", "patient", ".runtime", "groups");
    fs.mkdirSync(groupsDir, { recursive: true });
    fs.writeFileSync(
      path.join(groupsDir, "g1.json"),
      JSON.stringify({
        version: 3,
        userId: "patient",
        currentSessionId: "s0",
        sessionIds: [],
        pendingDelegations: [],
      }),
    );

    const note = Buffer.from("group note", "utf8").toString("base64");
    const staged = await fetch(`${local.url}/groups/g1/attachments`, {
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
    // 与一对一同一套 stageAttachment：<stem>_<id>.<ext>
    expect(attachment.path).toMatch(/^ATTACHMENTS\/note_[a-f0-9]{8}\.txt$/i);
    expect(
      fs.existsSync(
        path.join(root, "users", "patient", ".runtime", "groups", "g1", "workspace", attachment.path),
      ),
    ).toBe(true);
  } finally {
    await local.close();
  }
});

it("accepts multi-megabyte base64 attachments past the 1MB body gate", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pa-body-"));
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  const headers = { authorization: "Bearer token", "content-type": "application/json" };
  try {
    // 2MB 截图级附件：base64 后 ~2.7MB body。此前 readJson 的 1MB 闸一律 413「请求过大」，
    // 15MB 业务上限形同虚设；附件端点应放宽到能承载 15MB 附件的 body。
    const big = Buffer.alloc(2 * 1024 * 1024, 1).toString("base64");
    const staged = await fetch(`${local.url}/personal-assistant/attachments`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user_id: "patient",
        name: "screenshot.png",
        media_type: "image/png",
        data_base64: big,
      }),
    });
    expect(staged.status).toBe(200);
    const attachment = (await staged.json()) as { path: string };
    expect(
      fs.existsSync(path.join(root, "users", "patient", "personal-assistant", "cwd", attachment.path)),
    ).toBe(true);

    // 防滥用闸仍在：远超 15MB 附件所需 body（15MB×1.37≈20.6MB + 余量=22MB）时 413
    const tooBig = Buffer.alloc(23 * 1024 * 1024, 1).toString("base64");
    const refused = await fetch(`${local.url}/personal-assistant/attachments`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user_id: "patient",
        name: "huge.png",
        media_type: "image/png",
        data_base64: tooBig,
      }),
    });
    expect(refused.status).toBe(413);
  } finally {
    await local.close();
  }
});
