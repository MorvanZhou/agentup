import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { readLocalPackageVersions } from "../src/local/agents/versions.js";
import { startLocalServer } from "../src/local/server.js";
import {
  clearAgentChatUi,
  clearSessionCommandAllow,
  readState,
  setCommandAllow,
  writeUiState,
} from "../src/local/user/state.js";

it("persists unread, previews, lastActiveAt and command allow under state.json", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-state-"));
  expect(readState(root, "patient-a")).toEqual({
    unread: {},
    previews: {},
    lastActiveAt: {},
    commandAllow: {},
    delegationAllow: {},
  });
  writeUiState(
    root,
    "patient-a",
    { weather: 2, "respiratory-doctor": 0 },
    { weather: "明天晴吗" },
    { weather: 1_700_000_000_000 },
  );
  setCommandAllow(root, "patient-a", "weather", "session");
  expect(readState(root, "patient-a")).toEqual({
    unread: { weather: 2 },
    previews: { weather: "明天晴吗" },
    lastActiveAt: { weather: 1_700_000_000_000 },
    commandAllow: { weather: "session" },
    delegationAllow: {},
  });
  expect(fs.statSync(path.join(root, "users", "patient-a", "state.json")).mode & 0o777).toBe(0o600);
});

it("keeps previews when unread and command allow change", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-state-keep-"));
  writeUiState(root, "patient-a", { weather: 1 }, { weather: "晴" }, { weather: 10 });
  setCommandAllow(root, "patient-a", "weather", "agent");
  writeUiState(root, "patient-a", { weather: 3 }, { weather: "晴" }, { weather: 20 });
  expect(readState(root, "patient-a")).toEqual({
    unread: { weather: 3 },
    previews: { weather: "晴" },
    lastActiveAt: { weather: 20 },
    commandAllow: { weather: "agent" },
    delegationAllow: {},
  });
});

it("defaults missing previews and lastActiveAt in legacy state.json", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-state-req-"));
  const dir = path.join(root, "users", "patient-a");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "state.json"),
    `${JSON.stringify({ unread: {}, commandAllow: { weather: "session" }, remarks: { weather: "旧备注" } }, null, 2)}\n`,
  );
  expect(readState(root, "patient-a")).toEqual({
    unread: {},
    previews: {},
    lastActiveAt: {},
    commandAllow: { weather: "session" },
    delegationAllow: {},
  });
});

it("clears chat UI fields without dropping command allow", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-state-chat-ui-"));
  writeUiState(root, "patient-a", { weather: 2 }, { weather: "明天晴吗" }, { weather: 1_700_000_000_000 });
  setCommandAllow(root, "patient-a", "weather", "agent");
  expect(clearAgentChatUi(root, "patient-a", "weather")).toEqual({
    unread: {},
    previews: {},
    lastActiveAt: {},
    commandAllow: { weather: "agent" },
    delegationAllow: {},
  });
});

it("clears only session-scoped command allow", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-state-scope-"));
  setCommandAllow(root, "patient-a", "weather", "session");
  setCommandAllow(root, "patient-a", "doctor", "agent");
  clearSessionCommandAllow(root, "patient-a", "weather");
  clearSessionCommandAllow(root, "patient-a", "doctor");
  expect(readState(root, "patient-a").commandAllow).toEqual({ doctor: "agent" });
});

it("does not downgrade agent allow to session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-state-rank-"));
  setCommandAllow(root, "patient-a", "weather", "agent");
  setCommandAllow(root, "patient-a", "weather", "session");
  expect(readState(root, "patient-a").commandAllow).toEqual({ weather: "agent" });
});

it("reads local package versions from instance.json", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-local-ver-"));
  const agentRoot = path.join(root, "users", "patient-a", "agents", "weather");
  fs.mkdirSync(agentRoot, { recursive: true });
  fs.writeFileSync(
    path.join(agentRoot, "instance.json"),
    JSON.stringify({ agent_id: "weather", package_version: 3 }),
  );
  expect(readLocalPackageVersions(root, "patient-a")).toEqual({ weather: 3 });
  expect(readLocalPackageVersions(root, "patient-b")).toEqual({});
});

it("exposes state through the loopback API", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-state-api-"));
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const empty = await fetch(`${local.url}/state?user_id=patient-a`, {
      headers: { authorization: "Bearer token" },
    });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({
      unread: {},
      previews: {},
      last_active_at: {},
      command_allow: {},
    });

    const saved = await fetch(`${local.url}/state`, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({
        user_id: "patient-a",
        unread: { weather: 1 },
        previews: { weather: "晴" },
        last_active_at: { weather: 42 },
      }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      unread: { weather: 1 },
      previews: { weather: "晴" },
      last_active_at: { weather: 42 },
      command_allow: {},
    });
    expect(readState(root, "patient-a")).toEqual({
      unread: { weather: 1 },
      previews: { weather: "晴" },
      lastActiveAt: { weather: 42 },
      commandAllow: {},
      delegationAllow: {},
    });

    const missingPreviews = await fetch(`${local.url}/state`, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({ user_id: "patient-a", unread: { weather: 2 } }),
    });
    expect(missingPreviews.status).toBe(400);
  } finally {
    await local.close();
  }
});
