import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  ensurePersonalAssistant,
  personalAssistantVisit,
  readPersonalAssistantProfile,
  writePersonalAssistantProfile,
} from "../src/local/personal-assistant.js";
import { startLocalServer } from "../src/local/server.js";

it("removes leftover cwd/.pi so personal config stays outside the work tree", () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-personal-clean-pi-"));
  const root = path.join(data, "users", "patient", "personal-assistant");
  fs.mkdirSync(path.join(root, "cwd", ".pi"), { recursive: true });
  fs.writeFileSync(path.join(root, "cwd", ".pi", "SYSTEM.md"), "stale\n");
  fs.writeFileSync(path.join(root, "cwd", ".pi", "AGENTS.md"), "stale agents\n");

  ensurePersonalAssistant(data, "patient");
  expect(fs.existsSync(path.join(root, "cwd", ".pi"))).toBe(false);
  expect(fs.readFileSync(path.join(root, ".runtime", "SYSTEM.md"), "utf8")).toContain("私人助理");
});

it("migrates legacy personal resources into the private assistant directory", () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-personal-migrate-"));
  const userRoot = path.join(data, "users", "patient");
  fs.mkdirSync(path.join(userRoot, "skills", "notes"), { recursive: true });
  fs.writeFileSync(path.join(userRoot, "skills", "notes", "SKILL.md"), "legacy");
  fs.writeFileSync(path.join(userRoot, "mcp.json"), JSON.stringify({ mcpServers: {} }));

  const root = ensurePersonalAssistant(data, "patient");
  expect(root).toBe(path.join(userRoot, "personal-assistant"));
  expect(fs.existsSync(path.join(root, "skills", "notes", "SKILL.md"))).toBe(true);
  expect(fs.existsSync(path.join(root, "mcp.json"))).toBe(true);
  expect(fs.existsSync(path.join(userRoot, "skills"))).toBe(false);
  expect(fs.existsSync(path.join(root, ".runtime"))).toBe(true);
  expect(fs.existsSync(path.join(root, "sessions"))).toBe(true);
  expect(fs.existsSync(path.join(root, "cwd"))).toBe(true);
  expect(fs.existsSync(path.join(root, "cwd", ".pi"))).toBe(false);
  expect(fs.readFileSync(path.join(root, ".runtime", "SYSTEM.md"), "utf8")).toContain("私人助理");
});

it("stores editable profile and projects instructions into agentDir SYSTEM.md", () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-personal-profile-"));
  const saved = writePersonalAssistantProfile(data, "patient", {
    name: "小舟",
    instructions: "你是我的研究助理。",
    avatarDataUrl: `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64")}`,
  });
  expect(saved).toMatchObject({ name: "小舟", instructions: "你是我的研究助理。" });
  expect(saved.avatarUrl).toMatch(/^data:image\/png;base64,/);
  const root = ensurePersonalAssistant(data, "patient");
  expect(fs.readFileSync(path.join(root, ".runtime", "SYSTEM.md"), "utf8")).toBe("你是我的研究助理。\n");
  expect(fs.existsSync(path.join(root, "cwd", ".pi"))).toBe(false);
  expect(readPersonalAssistantProfile(data, "patient").name).toBe("小舟");
  expect(personalAssistantVisit(data, "patient")).toMatchObject({
    kind: "personal",
    agentId: "personal-assistant",
    root,
  });
});

it("reads and updates the private assistant profile through the loopback API", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-personal-api-"));
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: data,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const before = await fetch(`${local.url}/personal-assistant/profile?user_id=patient`, {
      headers: { authorization: "Bearer token" },
    });
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ name: "小A" });

    const english = await fetch(`${local.url}/personal-assistant/profile?user_id=patient&lang=en`, {
      headers: { authorization: "Bearer token" },
    });
    expect(english.status).toBe(200);
    expect(await english.json()).toMatchObject({ name: "Ace" });

    const saved = await fetch(`${local.url}/personal-assistant/profile`, {
      method: "PUT",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        user_id: "patient",
        name: "小舟",
        instructions: "你是我的研究助理。",
      }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      name: "小舟",
      instructions: "你是我的研究助理。",
      avatar_url: null,
    });
  } finally {
    await local.close();
  }
});
