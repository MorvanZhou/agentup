import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";
import type { Skill } from "@earendil-works/pi-coding-agent";

import { expandSkillReferences } from "../src/session/expand-skills.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fakeSkill(name: string, body: string): Skill {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-expand-skill-"));
  tempDirs.push(root);
  const filePath = path.join(root, "SKILL.md");
  fs.writeFileSync(filePath, `---\nname: ${name}\ndescription: d\n---\n\n${body}\n`);
  return {
    name,
    description: "d",
    filePath,
    baseDir: root,
    sourceInfo: { source: "test", path: root, scope: "project" } as Skill["sourceInfo"],
    disableModelInvocation: false,
  };
}

it("expands mid-text /name refs into leading skill blocks", () => {
  const weather = fakeSkill("check-weather", "# Weather\nUse the script.");
  const expanded = expandSkillReferences("请用 /check-weather 查杭州", [weather]);
  expect(expanded.startsWith('<skill name="check-weather"')).toBe(true);
  expect(expanded).toContain("location=");
  expect(expanded).toContain("# Weather");
  expect(expanded.endsWith("请用 查杭州")).toBe(true);
  expect(expanded.includes("/check-weather")).toBe(false);
});

it("accepts Pi /skill:name and dedupes multiple refs", () => {
  const notes = fakeSkill("note-taker", "Take notes.");
  const expanded = expandSkillReferences("先 /skill:note-taker 再 /note-taker 一次", [notes]);
  expect(expanded.match(/<skill /g)?.length).toBe(1);
  expect(expanded).toContain("先 再 一次");
});

it("leaves unknown slash tokens untouched", () => {
  const weather = fakeSkill("check-weather", "body");
  expect(expandSkillReferences("run /not-a-skill now", [weather])).toBe("run /not-a-skill now");
});

it("requires space before CJK args (does not expand glued tokens)", () => {
  const weather = fakeSkill("check-weather", "# Weather\nUse the script.");
  expect(expandSkillReferences("/check-weather杭州", [weather])).toBe("/check-weather杭州");
  const spaced = expandSkillReferences("/check-weather 杭州", [weather]);
  expect(spaced.startsWith('<skill name="check-weather"')).toBe(true);
  expect(spaced.endsWith("杭州")).toBe(true);
});
