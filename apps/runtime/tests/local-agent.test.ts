import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  bindLocalPublishedAgent,
  createLocalAgent,
  exportLocalAgentSkill,
  isLocalAgentId,
  listLocalAgents,
  localAgentVisit,
  writeLocalAgentCard,
} from "../src/local/agents/local-agent.js";
import { installSkillPackageTo } from "../src/local/assistant/user-resources.js";
import { loadAgentSource } from "../src/package/source.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-local-"));
  roots.push(root);
  return root;
}

it("scaffolds agents/<loc-*>/cwd/.pi like market visits", async () => {
  const userDataRoot = tempRoot();
  const card = await createLocalAgent(userDataRoot, "guest", {
    name: "天气助理",
    role: "气象顾问",
    background: "只回答天气相关问题",
    rules: "只处理天气查询与穿衣建议。",
  });

  expect(isLocalAgentId(card.agentId)).toBe(true);
  expect(card.agentId).toMatch(/^loc-[A-Za-z0-9]{8,16}$/);

  const visitRoot = path.join(userDataRoot, "users", "guest", "agents", card.agentId);
  const system = path.join(visitRoot, "cwd", ".pi", "SYSTEM.md");
  expect(fs.existsSync(system)).toBe(true);
  expect(fs.readFileSync(system, "utf8")).toMatch(/天气助理/);
  expect(fs.readFileSync(path.join(visitRoot, "cwd", ".pi", "AGENTS.md"), "utf8")).toMatch(
    /天气查询/,
  );
  expect(fs.readFileSync(path.join(visitRoot, ".runtime", "AGENTS.md"), "utf8")).toMatch(
    /天气查询/,
  );
  expect(fs.existsSync(path.join(visitRoot, "instance.json"))).toBe(true);

  const visit = localAgentVisit(userDataRoot, "guest", card.agentId);
  expect(visit.kind).toBe("local");
  expect(visit.root).toBe(visitRoot);

  const listed = listLocalAgents(userDataRoot, "guest");
  expect(listed).toHaveLength(1);
  expect(listed[0]!.agentId).toBe(card.agentId);
});

it("composes SYSTEM.md from unified identity", async () => {
  const userDataRoot = tempRoot();
  const card = await createLocalAgent(userDataRoot, "guest", {
    name: "简报助手",
    role: "摘要",
    background: "帮我把长文压成三条要点",
  });
  expect(card.background).toBe("帮我把长文压成三条要点");
  expect(card.rules).toBe("");
  const system = path.join(
    userDataRoot,
    "users",
    "guest",
    "agents",
    card.agentId,
    "cwd",
    ".pi",
    "SYSTEM.md",
  );
  expect(fs.readFileSync(system, "utf8")).toMatch(/三条要点/);
});

it("loadAgentSource accepts visit root cwd/.pi for one-click publish", async () => {
  const userDataRoot = tempRoot();
  const card = await createLocalAgent(userDataRoot, "guest", {
    name: "汇率助理",
    role: "金融助手",
    background: "只回答汇率换算问题。",
  });
  const visitRoot = path.join(userDataRoot, "users", "guest", "agents", card.agentId);
  const source = loadAgentSource(visitRoot);
  expect(source.files["SYSTEM.md"]).toBeTruthy();
  expect(Buffer.from(source.files["SYSTEM.md"]!).toString("utf8")).toMatch(/汇率换算/);
});

it("writeLocalAgentCard updates SYSTEM and mcpServers", async () => {
  const userDataRoot = tempRoot();
  const created = await createLocalAgent(userDataRoot, "guest", {
    name: "草稿",
    role: "测试",
    background: "最初简介",
  });
  const updated = await writeLocalAgentCard(
    userDataRoot,
    "guest",
    created.agentId,
    {
      name: "定稿",
      role: "测试员",
      background: "更新后的简介",
      rules: "先验证，再回答。",
      mcpServers: { demo: { url: "http://127.0.0.1:9001/mcp" } },
    },
  );
  expect(updated.name).toBe("定稿");
  expect(updated.background).toBe("更新后的简介");
  expect(updated.rules).toBe("先验证，再回答。");
  expect(updated.mcpServers).toEqual({ demo: { url: "http://127.0.0.1:9001/mcp" } });
  expect(updated.skills).toEqual([]);
});

it("exportLocalAgentSkill zips an installed skill for reinstall", async () => {
  const userDataRoot = tempRoot();
  const card = await createLocalAgent(userDataRoot, "guest", {
    name: "技能宿主",
    role: "测试",
    background: "简介",
  });
  const skillSrc = path.join(userDataRoot, "skill-src", "note-taker");
  fs.mkdirSync(skillSrc, { recursive: true });
  fs.writeFileSync(
    path.join(skillSrc, "SKILL.md"),
    `---
name: note-taker
description: 整理笔记
---

# note-taker
`,
  );
  const skillsDir = path.join(
    userDataRoot,
    "users",
    "guest",
    "agents",
    card.agentId,
    "cwd",
    ".pi",
    "skills",
  );
  await installSkillPackageTo(skillsDir, skillSrc);
  const zipPath = path.join(userDataRoot, "note-taker-export.zip");
  const exported = exportLocalAgentSkill(userDataRoot, "guest", card.agentId, "note-taker", zipPath);
  expect(exported.path).toBe(zipPath);
  expect(fs.existsSync(zipPath)).toBe(true);

  const reinstallRoot = path.join(userDataRoot, "reinstall-skills");
  fs.mkdirSync(reinstallRoot, { recursive: true });
  const reinstalled = await installSkillPackageTo(reinstallRoot, zipPath);
  expect(reinstalled.name).toBe("note-taker");
  expect(fs.existsSync(path.join(reinstallRoot, "note-taker", "SKILL.md"))).toBe(true);
});

it("bindLocalPublishedAgent stores market agent id for republish", async () => {
  const userDataRoot = tempRoot();
  const created = await createLocalAgent(userDataRoot, "guest", {
    name: "草稿",
    role: "测试",
    background: "简介",
  });
  const bound = bindLocalPublishedAgent(userDataRoot, "guest", created.agentId, "weather-bot");
  expect(bound.publishedAgentId).toBe("weather-bot");
  const listed = listLocalAgents(userDataRoot, "guest");
  expect(listed[0]!.publishedAgentId).toBe("weather-bot");
});

it("migrates legacy summary to background when reading", async () => {
  const userDataRoot = tempRoot();
  const created = await createLocalAgent(userDataRoot, "guest", {
    name: "旧名片",
    role: "测试",
    background: "旧版简介",
  });
  const instanceFile = path.join(
    userDataRoot,
    "users",
    "guest",
    "agents",
    created.agentId,
    "instance.json",
  );
  const instance = JSON.parse(fs.readFileSync(instanceFile, "utf8")) as Record<string, unknown>;
  instance.summary = instance.background;
  delete instance.background;
  fs.writeFileSync(instanceFile, `${JSON.stringify(instance, null, 2)}\n`);

  expect(listLocalAgents(userDataRoot, "guest")[0]!.background).toBe("旧版简介");
  const migrated = JSON.parse(fs.readFileSync(instanceFile, "utf8")) as Record<string, unknown>;
  expect(migrated.background).toBe("旧版简介");
  expect(migrated).not.toHaveProperty("summary");
});
