import fs from "node:fs";
import path from "node:path";

import type { Visit } from "../../package/sync.js";
import { listUserSkills } from "../../local/assistant/user-resources.js";

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 当前会话可经 `/skill:name` 显式调用的 skill（仅 name + description）。 */
export interface InvocableSkill {
  name: string;
  description: string;
}

/** 私人助理：已激活；第三方 Agent：运行包 `.pi/skills`。 */
export function listVisitSkills(visit: Visit, userDataRoot?: string): InvocableSkill[] {
  if (visit.kind === "personal") {
    if (!userDataRoot) return [];
    return listUserSkills(userDataRoot, visit.userId)
      .filter((skill) => skill.enabled)
      .map((skill) => ({ name: skill.name, description: skill.description }));
  }
  return listPackageSkills(path.join(visit.root, "cwd", ".pi", "skills"));
}

export function listPackageSkills(skillsDir: string): InvocableSkill[] {
  if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) return [];
  const skills: InvocableSkill[] = [];
  for (const name of fs.readdirSync(skillsDir).sort()) {
    if (!SKILL_NAME.test(name)) continue;
    const file = path.join(skillsDir, name, "SKILL.md");
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    skills.push({
      name,
      description: skillDescription(fs.readFileSync(file, "utf8")),
    });
  }
  return skills;
}

function skillDescription(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return "";
  const line = match[1].split(/\r?\n/).find((entry) => entry.startsWith("description:"));
  if (!line) return "";
  return line.slice("description:".length).trim().replace(/^["']|["']$/g, "");
}
