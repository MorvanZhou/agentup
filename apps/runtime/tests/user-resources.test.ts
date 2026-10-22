import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { expect, it } from "vitest";

import { startLocalServer } from "../src/local/server.js";
import {
  UserResourceError,
  deleteUserSkill,
  installUserSkillPackage,
  listEnabledUserSkillPaths,
  listUserSkills,
  readUserAgentsMd,
  setUserSkillEnabled,
  userAgentsMdPath,
  userMcpPath,
  userResourceRoot,
  userSkillsDir,
  writeUserAgentsMd,
  writeUserMcpServers,
} from "../src/local/assistant/user-resources.js";

const skillMd = (name: string, description: string) => `---
name: ${name}
description: ${description}
---

# ${name}

正文。
`;

function writeSkillDir(root: string, name: string, description: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), skillMd(name, description));
  return dir;
}

it("installs account skills from a folder and toggles enabled state", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-user-res-"));
  const source = writeSkillDir(fs.mkdtempSync(path.join(os.tmpdir(), "skill-src-")), "note-taker", "整理笔记");
  const skill = await installUserSkillPackage(data, "patient", source);
  expect(skill).toMatchObject({ name: "note-taker", description: "整理笔记", enabled: true });
  expect(listUserSkills(data, "patient")).toHaveLength(1);
  expect(userSkillsDir(data, "patient").includes(`${path.sep}.agents${path.sep}`)).toBe(false);
  expect(listEnabledUserSkillPaths(userResourceRoot(data, "patient"))).toHaveLength(1);

  setUserSkillEnabled(data, "patient", "note-taker", false);
  expect(listUserSkills(data, "patient")[0]?.enabled).toBe(false);
  expect(listEnabledUserSkillPaths(userResourceRoot(data, "patient"))).toEqual([]);

  writeUserMcpServers(data, "patient", {
    notes: { url: "http://127.0.0.1:9001/mcp" },
  });
  expect(fs.existsSync(userMcpPath(data, "patient"))).toBe(true);

  deleteUserSkill(data, "patient", "note-taker");
  expect(listUserSkills(data, "patient")).toEqual([]);
  await expect(installUserSkillPackage(data, "patient", source, { expectName: "other" })).rejects.toBeInstanceOf(
    UserResourceError,
  );
});

it("installs a skill from zip through the loopback API", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-user-api-"));
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-zip-"));
  const skillDir = writeSkillDir(packageRoot, "note-taker", "整理笔记");
  const zipPath = path.join(packageRoot, "note-taker.zip");
  execFileSync("zip", ["-r", zipPath, "."], { cwd: skillDir });

  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: data,
    host: "127.0.0.1",
    port: 0,
  });
  const headers = { authorization: "Bearer token", "content-type": "application/json" };
  try {
    const installed = await fetch(`${local.url}/settings/skills/install`, {
      method: "POST",
      headers,
      body: JSON.stringify({ user_id: "patient", path: zipPath }),
    });
    expect(installed.status).toBe(200);
    expect(await installed.json()).toMatchObject({ name: "note-taker", enabled: true });

    const toggled = await fetch(`${local.url}/settings/skills/note-taker/enabled`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ user_id: "patient", enabled: false }),
    });
    expect(toggled.status).toBe(200);
    expect(await toggled.json()).toMatchObject({ enabled: false });

    const listed = await (await fetch(`${local.url}/settings/skills?user_id=patient`, { headers })).json();
    expect(listed.skills).toEqual([{ name: "note-taker", description: "整理笔记", enabled: false }]);

    const removed = await fetch(`${local.url}/settings/skills/note-taker?user_id=patient`, {
      method: "DELETE",
      headers: { authorization: "Bearer token" },
    });
    expect(removed.status).toBe(200);
  } finally {
    await local.close();
  }
});

it("writes AGENTS.md under .runtime agentDir", () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-user-agents-"));
  const content = writeUserAgentsMd(data, "patient", "# 规则\n\n回答简洁。");
  expect(content).toContain("回答简洁。");
  expect(userAgentsMdPath(data, "patient").endsWith(`${path.sep}.runtime${path.sep}AGENTS.md`)).toBe(true);
  expect(readUserAgentsMd(data, "patient")).toContain("回答简洁。");
  expect(fs.existsSync(path.join(userResourceRoot(data, "patient"), "cwd", ".pi"))).toBe(false);

  expect(writeUserAgentsMd(data, "patient", "   ")).toBe("");
  expect(fs.existsSync(userAgentsMdPath(data, "patient"))).toBe(false);
});

it("reads and writes private MCP config through the loopback API", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-mcp-api-"));
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: data,
    host: "127.0.0.1",
    port: 0,
  });
  const headers = { authorization: "Bearer token", "content-type": "application/json" };
  try {
    const empty = await fetch(`${local.url}/settings/mcp?user_id=patient`, { headers });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ mcp_servers: {} });

    const written = await fetch(`${local.url}/settings/mcp`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        user_id: "patient",
        mcp_servers: { notes: { url: "http://127.0.0.1:9001/mcp" } },
      }),
    });
    expect(written.status).toBe(200);
    expect(await written.json()).toMatchObject({
      mcp_servers: { notes: { url: "http://127.0.0.1:9001/mcp" } },
    });

    const listed = await fetch(`${local.url}/settings/mcp?user_id=patient`, { headers });
    expect(await listed.json()).toMatchObject({
      mcp_servers: { notes: { url: "http://127.0.0.1:9001/mcp" } },
    });

    expect(
      (
        await fetch(`${local.url}/settings/mcp`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ user_id: "patient", mcp_servers: [] }),
        })
      ).status,
    ).toBe(400);
    expect((await fetch(`${local.url}/settings/mcp?user_id=patient`)).status).toBe(401);
  } finally {
    await local.close();
  }
});

it("manages AGENTS.md through the loopback API", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-agents-api-"));
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: data,
    host: "127.0.0.1",
    port: 0,
  });
  const headers = { authorization: "Bearer token", "content-type": "application/json" };
  try {
    const content = "# 语气\n\n回答简洁。\n";
    const written = await fetch(`${local.url}/settings/agents-md`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        user_id: "patient",
        content,
      }),
    });
    expect(written.status).toBe(200);
    expect(await written.json()).toEqual({ content });

    const detail = await fetch(`${local.url}/settings/agents-md?user_id=patient`, { headers });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual({ content });

    const cleared = await fetch(`${local.url}/settings/agents-md`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ user_id: "patient", content: "" }),
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ content: "" });
  } finally {
    await local.close();
  }
});
