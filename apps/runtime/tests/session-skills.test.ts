import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { startLocalServer } from "../src/local/server.js";
import { installUserSkillPackage, setUserSkillEnabled } from "../src/local/assistant/user-resources.js";
import { listPackageSkills, listVisitSkills } from "../src/session/skills/skills.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeSkillDir(root: string, name: string, description: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
  return dir;
}

it("lists package skills from .pi/skills", () => {
  const root = tempDir("agentup-pkg-skills-");
  writeSkillDir(root, "check-weather", "查天气");
  writeSkillDir(root, "other", "其它");
  expect(listPackageSkills(root)).toEqual([
    { name: "check-weather", description: "查天气" },
    { name: "other", description: "其它" },
  ]);
});

it("lists only enabled personal skills for a visit", async () => {
  const data = tempDir("agentup-visit-skills-");
  const source = writeSkillDir(tempDir("skill-src-"), "note-taker", "整理笔记");
  await installUserSkillPackage(data, "patient", source);
  setUserSkillEnabled(data, "patient", "note-taker", false);
  const disabled = listVisitSkills(
    {
      kind: "personal",
      userId: "patient",
      agentId: "personal-assistant",
      root: path.join(data, "users", "patient", "personal-assistant"),
      packageVersion: 1,
      packageDigest: "personal-assistant-v1",
      tools: [],
      modelCapabilities: [],
      projectTrust: "granted",
    },
    data,
  );
  expect(disabled).toEqual([]);

  setUserSkillEnabled(data, "patient", "note-taker", true);
  const enabled = listVisitSkills(
    {
      kind: "personal",
      userId: "patient",
      agentId: "personal-assistant",
      root: path.join(data, "users", "patient", "personal-assistant"),
      packageVersion: 1,
      packageDigest: "personal-assistant-v1",
      tools: [],
      modelCapabilities: [],
      projectTrust: "granted",
    },
    data,
  );
  expect(enabled).toEqual([{ name: "note-taker", description: "整理笔记" }]);
});

it("serves invocable skills over local HTTP", async () => {
  const data = tempDir("agentup-skills-http-");
  const source = writeSkillDir(tempDir("skill-http-src-"), "note-taker", "整理笔记");
  await installUserSkillPackage(data, "patient", source);

  const agentSkills = path.join(data, "users", "patient", "agents", "world-clock", "cwd", ".pi", "skills");
  writeSkillDir(agentSkills, "check-world-clock", "查世界时钟");

  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: data,
    host: "127.0.0.1",
    port: 0,
  });
  const headers = { authorization: "Bearer token" };
  try {
    const personal = await (
      await fetch(`${local.url}/personal-assistant/skills?user_id=patient`, { headers })
    ).json();
    expect(personal.skills).toEqual([{ name: "note-taker", description: "整理笔记" }]);

    const agent = await (
      await fetch(`${local.url}/agents/world-clock/skills?user_id=patient`, { headers })
    ).json();
    expect(agent.skills).toEqual([{ name: "check-world-clock", description: "查世界时钟" }]);
  } finally {
    await local.close();
  }
});
