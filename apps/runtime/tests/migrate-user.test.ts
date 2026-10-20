import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { migrateUserData } from "../src/local/migrate-user.js";
import { startLocalServer } from "../src/local/server.js";

it("renames guest user directory onto a new account id", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-migrate-"));
  const guest = path.join(root, "users", "guest", "personal-assistant");
  fs.mkdirSync(guest, { recursive: true });
  fs.writeFileSync(path.join(guest, "profile.json"), '{"name":"guest-pa"}');

  migrateUserData(root, "guest", "u-real");

  expect(fs.existsSync(path.join(root, "users", "guest"))).toBe(false);
  expect(fs.readFileSync(path.join(root, "users", "u-real", "personal-assistant", "profile.json"), "utf8")).toBe(
    '{"name":"guest-pa"}',
  );
});

it("merges guest files into an existing account directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-merge-"));
  const guestAgents = path.join(root, "users", "guest", "agents", "weather");
  const realPa = path.join(root, "users", "u-real", "personal-assistant");
  fs.mkdirSync(guestAgents, { recursive: true });
  fs.mkdirSync(realPa, { recursive: true });
  fs.writeFileSync(path.join(guestAgents, "marker.txt"), "from-guest");
  fs.writeFileSync(path.join(realPa, "profile.json"), '{"name":"real"}');

  migrateUserData(root, "guest", "u-real");

  expect(fs.existsSync(path.join(root, "users", "guest"))).toBe(false);
  expect(fs.readFileSync(path.join(root, "users", "u-real", "agents", "weather", "marker.txt"), "utf8")).toBe(
    "from-guest",
  );
  expect(fs.readFileSync(path.join(realPa, "profile.json"), "utf8")).toBe('{"name":"real"}');
});

it("migrates guest data through the loopback API", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-migrate-api-"));
  const guest = path.join(root, "users", "guest", "personal-assistant");
  fs.mkdirSync(guest, { recursive: true });
  fs.writeFileSync(path.join(guest, "profile.json"), '{"name":"guest-pa"}');

  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    expect(
      (
        await fetch(`${local.url}/local/migrate-user`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ from_user_id: "guest", to_user_id: "u-real" }),
        })
      ).status,
    ).toBe(401);

    const migrated = await fetch(`${local.url}/local/migrate-user`, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({ from_user_id: "guest", to_user_id: "u-real" }),
    });
    expect(migrated.status).toBe(200);
    expect(await migrated.json()).toEqual({ migrated: true });
    expect(fs.existsSync(path.join(root, "users", "guest"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "users", "u-real", "personal-assistant", "profile.json"), "utf8")).toBe(
      '{"name":"guest-pa"}',
    );
  } finally {
    await local.close();
  }
});
